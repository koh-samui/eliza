import {
    composeContext,
    elizaLogger,
    generateText,
    generateTweetActions,
    getEmbeddingZeroVector,
    IAgentRuntime,
    IImageDescriptionService,
    ModelClass,
    postActionResponseFooter,
    ServiceType,
    stringToUuid,
    UUID,
} from "@elizaos/core";
import { Tweet } from "agent-twitter-client";
import { ClientBase } from "./base.ts";
import { DEFAULT_MAX_TWEET_LENGTH } from "./environment.ts";
import { twitterMessageHandlerTemplate } from "./interactions.ts";
import { scheduledTweets } from "./scheduled-tweets";
import { TweetScheduler } from "./scheduled-tweets/scheduler";
import { buildConversationThread } from "./utils.ts";

const twitterPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Task: Generate a post in the voice and style and perspective of {{agentName}} @{{twitterUserName}}.
Write a post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, just write the post.
Your response should be 1, 2, or 3 sentences (choose the length at random).
Your response should not contain any questions. Brief, concise statements only. The total character count MUST be less than {{maxTweetLength}}. No emojis. Use \\n\\n (double spaces) between statements if there are multiple statements in your response.`;

interface TwitterActionConfig {
    tag: string;
    description: string;
    active: boolean;
    maxExecutionsPerRun: number; // 0 means unlimited
    delayBetweenExecutions: number; // in minutes, 0 means no delay
    threshold: number; // confidence threshold 0-10
}

const TWITTER_ACTIONS: TwitterActionConfig[] = [
    {
        tag: "[LIKE]",
        description: "Perfect topic match AND aligns with character",
        active: true,
        maxExecutionsPerRun: 0, // unlimited likes per run
        delayBetweenExecutions: 0, // no delay between likes
        threshold: 9.8,
    },
    {
        tag: "[RETWEET]",
        description: "Exceptional content that embodies character's expertise",
        active: false,
        maxExecutionsPerRun: 0,
        delayBetweenExecutions: 0,
        threshold: 9.5,
    },
    {
        tag: "[QUOTE]",
        description: "Can add substantial domain expertise",
        active: true,
        maxExecutionsPerRun: 1, // max 1 quote per run
        delayBetweenExecutions: 72, // 72 minutes between quotes
        threshold: 9.5,
    },
    {
        tag: "[REPLY]",
        description: "Can contribute meaningful, expert-level insight",
        active: true,
        maxExecutionsPerRun: 2, // max 2 replies per run
        delayBetweenExecutions: 0,
        threshold: 9.5,
    },
];

const TIMELINE_FETCH_LIMIT = 10; // Number of tweets to fetch for action processing

export const twitterActionTemplate =
    `
# INSTRUCTIONS: Determine actions for {{agentName}} (@{{twitterUserName}}) based on:
{{bio}}
{{postDirections}}

Guidelines:
- ONLY engage with content that DIRECTLY relates to character's core interests
- Direct mentions are priority IF they are on-topic
- Skip ALL content that is:
  - Off-topic or tangentially related
  - From high-profile accounts unless explicitly relevant
  - Generic/viral content without specific relevance
  - Political/controversial unless central to character
  - Promotional/marketing unless directly relevant

Actions (respond only with tags):
${TWITTER_ACTIONS.filter((action) => action.active)
    .map(
        (action) =>
            `${action.tag} - ${action.description} (${action.threshold}/10)`
    )
    .join("\n")}

Tweet:
{{currentTweet}}

# Respond with qualifying action tags only. Default to NO action unless extremely confident of relevance.` +
    postActionResponseFooter;

/**
 * Truncate text to fit within the Twitter character limit, ensuring it ends at a complete sentence.
 */
function truncateToCompleteSentence(
    text: string,
    maxTweetLength: number
): string {
    if (text.length <= maxTweetLength) {
        return text;
    }

    // Attempt to truncate at the last period within the limit
    const lastPeriodIndex = text.lastIndexOf(".", maxTweetLength - 1);
    if (lastPeriodIndex !== -1) {
        const truncatedAtPeriod = text.slice(0, lastPeriodIndex + 1).trim();
        if (truncatedAtPeriod.length > 0) {
            return truncatedAtPeriod;
        }
    }

    // If no period, truncate to the nearest whitespace within the limit
    const lastSpaceIndex = text.lastIndexOf(" ", maxTweetLength - 1);
    if (lastSpaceIndex !== -1) {
        const truncatedAtSpace = text.slice(0, lastSpaceIndex).trim();
        if (truncatedAtSpace.length > 0) {
            return truncatedAtSpace + "...";
        }
    }

    // Fallback: Hard truncate and add ellipsis
    const hardTruncated = text.slice(0, maxTweetLength - 3).trim();
    return hardTruncated + "...";
}

export class TwitterPostClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    twitterUsername: string;
    private isProcessing: boolean = false;
    private lastProcessTime: number = 0;
    private stopProcessingActions: boolean = false;
    private isDryRun: boolean;
    private scheduler: TweetScheduler;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.twitterUsername = this.client.twitterConfig.TWITTER_USERNAME;
        this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN;

        // Log configuration on initialization
        elizaLogger.log("Twitter Client Configuration:");
        elizaLogger.log(`- Username: ${this.twitterUsername}`);
        elizaLogger.log(
            `- Dry Run Mode: ${this.isDryRun ? "enabled" : "disabled"}`
        );
        elizaLogger.log(
            `- Post Interval: ${this.client.twitterConfig.POST_INTERVAL_MIN}-${this.client.twitterConfig.POST_INTERVAL_MAX} minutes`
        );
        elizaLogger.log(
            `- Action Processing: ${this.client.twitterConfig.ENABLE_ACTION_PROCESSING ? "enabled" : "disabled"}`
        );
        elizaLogger.log(
            `- Action Interval: ${this.client.twitterConfig.ACTION_INTERVAL} minutes`
        );
        elizaLogger.log(
            `- Post Immediately: ${this.client.twitterConfig.POST_IMMEDIATELY ? "enabled" : "disabled"}`
        );
        elizaLogger.log(
            `- Search Enabled: ${this.client.twitterConfig.TWITTER_SEARCH_ENABLE ? "enabled" : "disabled"}`
        );

        const targetUsers = this.client.twitterConfig.TWITTER_TARGET_USERS;
        if (targetUsers) {
            elizaLogger.log(`- Target Users: ${targetUsers}`);
        }

        if (this.isDryRun) {
            elizaLogger.log(
                "Twitter client initialized in dry run mode - no actual tweets should be posted"
            );
        }

        this.scheduler = new TweetScheduler(
            scheduledTweets,
            this.runtime,
            this.twitterUsername
        );
    }

    async start() {
        if (!this.client.profile) {
            await this.client.init();
        }

        const generateNewTweetLoop = async () => {
            const lastPost = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>("twitter/" + this.twitterUsername + "/lastPost");

            const lastPostTimestamp = lastPost?.timestamp ?? 0;
            const minMinutes = this.client.twitterConfig.POST_INTERVAL_MIN;
            const maxMinutes = this.client.twitterConfig.POST_INTERVAL_MAX;
            const randomMinutes =
                Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) +
                minMinutes;
            const delay = randomMinutes * 60 * 1000;

            if (Date.now() > lastPostTimestamp + delay) {
                await this.generateNewTweet();
            }

            setTimeout(() => {
                generateNewTweetLoop(); // Set up next iteration
            }, delay);

            elizaLogger.log(`Next tweet scheduled in ${randomMinutes} minutes`);
        };

        const processActionsLoop = async () => {
            const actionInterval = this.client.twitterConfig.ACTION_INTERVAL; // Defaults to 5 minutes

            while (!this.stopProcessingActions) {
                try {
                    const results = await this.processTweetActions();
                    if (results) {
                        elizaLogger.log(`Processed ${results.length} tweets`);
                        elizaLogger.log(
                            `Next action processing scheduled in ${actionInterval} minutes`
                        );
                        // Wait for the full interval before next processing
                        await new Promise(
                            (resolve) =>
                                setTimeout(resolve, actionInterval * 60 * 1000) // now in minutes
                        );
                    }
                } catch (error) {
                    elizaLogger.error(
                        "Error in action processing loop:",
                        error
                    );
                    // Add exponential backoff on error
                    await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30s on error
                }
            }
        };

        if (this.client.twitterConfig.POST_IMMEDIATELY) {
            await this.generateNewTweet();
        }

        // Only start tweet generation loop if not in dry run mode
        generateNewTweetLoop();

        if (
            this.client.twitterConfig.ENABLE_ACTION_PROCESSING &&
            !this.isDryRun
        ) {
            processActionsLoop().catch((error) => {
                elizaLogger.error(
                    "Fatal error in process actions loop:",
                    error
                );
            });
        } else {
            if (this.isDryRun) {
                elizaLogger.log(
                    "Action processing loop disabled (dry run mode)"
                );
            } else {
                elizaLogger.log(
                    "Action processing loop disabled by configuration"
                );
            }
        }
    }

    createTweetObject(
        tweetResult: any,
        client: any,
        twitterUsername: string
    ): Tweet {
        return {
            id: tweetResult.rest_id,
            name: client.profile.screenName,
            username: client.profile.username,
            text: tweetResult.legacy.full_text,
            conversationId: tweetResult.legacy.conversation_id_str,
            createdAt: tweetResult.legacy.created_at,
            timestamp: new Date(tweetResult.legacy.created_at).getTime(),
            userId: client.profile.id,
            inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
            permanentUrl: `https://twitter.com/${twitterUsername}/status/${tweetResult.rest_id}`,
            hashtags: [],
            mentions: [],
            photos: [],
            thread: [],
            urls: [],
            videos: [],
        } as Tweet;
    }

    async processAndCacheTweet(
        runtime: IAgentRuntime,
        client: ClientBase,
        tweet: Tweet,
        roomId: UUID,
        newTweetContent: string
    ) {
        // Cache the last post details
        await runtime.cacheManager.set(
            `twitter/${client.profile.username}/lastPost`,
            {
                id: tweet.id,
                timestamp: Date.now(),
            }
        );

        // Cache the tweet
        await client.cacheTweet(tweet);

        // Log the posted tweet
        elizaLogger.log(`Tweet posted:\n ${tweet.permanentUrl}`);

        // Ensure the room and participant exist
        await runtime.ensureRoomExists(roomId);
        await runtime.ensureParticipantInRoom(runtime.agentId, roomId);

        // Create a memory for the tweet
        await runtime.messageManager.createMemory({
            id: stringToUuid(tweet.id + "-" + runtime.agentId),
            userId: runtime.agentId,
            agentId: runtime.agentId,
            content: {
                text: newTweetContent.trim(),
                url: tweet.permanentUrl,
                source: "twitter",
            },
            roomId,
            embedding: getEmbeddingZeroVector(),
            createdAt: tweet.timestamp,
        });
    }

    async handleNoteTweet(
        client: ClientBase,
        runtime: IAgentRuntime,
        content: string,
        tweetId?: string
    ) {
        try {
            const noteTweetResult = await client.requestQueue.add(
                async () =>
                    await client.twitterClient.sendNoteTweet(content, tweetId)
            );

            if (noteTweetResult.errors && noteTweetResult.errors.length > 0) {
                // Note Tweet failed due to authorization. Falling back to standard Tweet.
                const truncateContent = truncateToCompleteSentence(
                    content,
                    this.client.twitterConfig.MAX_TWEET_LENGTH
                );
                return await this.sendStandardTweet(
                    client,
                    truncateContent,
                    tweetId
                );
            } else {
                return noteTweetResult.data.notetweet_create.tweet_results
                    .result;
            }
        } catch (error) {
            throw new Error(`Note Tweet failed: ${error}`);
        }
    }

    async sendStandardTweet(
        client: ClientBase,
        content: string,
        tweetId?: string,
        mediaData?: { data: Buffer; mediaType: string }[] | null
    ) {
        try {
            const standardTweetResult = await client.requestQueue.add(
                async () =>
                    await client.twitterClient.sendTweet(
                        content,
                        tweetId,
                        mediaData
                    )
            );
            const body = await standardTweetResult.json();
            if (!body?.data?.create_tweet?.tweet_results?.result) {
                console.error("Error sending tweet; Bad response:", body);
                return;
            }
            return body.data.create_tweet.tweet_results.result;
        } catch (error) {
            elizaLogger.error("Error sending standard Tweet:", error);
            throw error;
        }
    }

    async postTweet(
        runtime: IAgentRuntime,
        client: ClientBase,
        cleanedContent: string,
        roomId: UUID,
        newTweetContent: string,
        twitterUsername: string,
        mediaData?: { data: Buffer; mediaType: string }[] | null
    ) {
        try {
            elizaLogger.log(`Posting new tweet:\n`);

            let result;

            if (cleanedContent.length > DEFAULT_MAX_TWEET_LENGTH) {
                result = await this.handleNoteTweet(
                    client,
                    runtime,
                    cleanedContent
                );
            } else {
                result = await this.sendStandardTweet(
                    client,
                    cleanedContent,
                    undefined,
                    mediaData
                );
            }

            const tweet = this.createTweetObject(
                result,
                client,
                twitterUsername
            );

            await this.processAndCacheTweet(
                runtime,
                client,
                tweet,
                roomId,
                newTweetContent
            );
        } catch (error) {
            elizaLogger.error("Error sending tweet:", error);
        }
    }

    /**
     * Generates and posts a new tweet. If isDryRun is true, only logs what would have been posted.
     */
    private async generateNewTweet() {
        try {
            // Check for scheduled tweets first
            const scheduledTweet = await this.scheduler.getNextScheduledTweet();
            if (scheduledTweet) {
                if (this.isDryRun) {
                    elizaLogger.info(
                        `Dry run: would have posted scheduled tweet:\n${scheduledTweet.content}${
                            scheduledTweet.mediaData
                                ? "\nWith media attachment"
                                : ""
                        }`
                    );
                    return;
                }

                await this.postTweet(
                    this.runtime,
                    this.client,
                    scheduledTweet.content,
                    stringToUuid(
                        "scheduled-tweet-room-" + this.twitterUsername
                    ),
                    scheduledTweet.content,
                    this.twitterUsername,
                    scheduledTweet.mediaData
                );
                return;
            }

            // Fall back to regular tweet generation
            elizaLogger.log("Generating new tweet");

            let cleanedContent: string;
            const roomId = stringToUuid(
                "twitter_generate_room-" + this.client.profile.username
            );

            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.client.profile.username,
                this.runtime.character.name,
                "twitter"
            );

            const topics = this.runtime.character.topics.join(", ");

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: roomId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: topics || "",
                        action: "TWEET",
                    },
                },
                {
                    twitterUserName: this.client.profile.username,
                }
            );

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterPostTemplate ||
                    twitterPostTemplate,
            });

            elizaLogger.debug("generate post prompt:\n" + context);

            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            // First attempt to clean content
            cleanedContent = "";

            // Try parsing as JSON first
            try {
                const parsedResponse = JSON.parse(newTweetContent);
                if (parsedResponse.text) {
                    cleanedContent = parsedResponse.text;
                } else if (typeof parsedResponse === "string") {
                    cleanedContent = parsedResponse;
                }
            } catch (error) {
                error.linted = true; // make linter happy since catch needs a variable
                // If not JSON, clean the raw content
                cleanedContent = newTweetContent
                    .replace(/^\s*{?\s*"text":\s*"|"\s*}?\s*$/g, "") // Remove JSON-like wrapper
                    .replace(/^['"](.*)['"]$/g, "$1") // Remove quotes
                    .replace(/\\"/g, '"') // Unescape quotes
                    .replace(/\\n/g, "\n\n") // Unescape newlines, ensures double spaces
                    .trim();
            }

            if (!cleanedContent) {
                elizaLogger.error(
                    "Failed to extract valid content from response:",
                    {
                        rawResponse: newTweetContent,
                        attempted: "JSON parsing",
                    }
                );
                return;
            }

            // Truncate the content to the maximum tweet length specified in the environment settings, ensuring the truncation respects sentence boundaries.
            const maxTweetLength = this.client.twitterConfig.MAX_TWEET_LENGTH;
            if (maxTweetLength) {
                cleanedContent = truncateToCompleteSentence(
                    cleanedContent,
                    maxTweetLength
                );
            }

            const removeQuotes = (str: string) =>
                str.replace(/^['"](.*)['"]$/, "$1");

            const fixNewLines = (str: string) => str.replaceAll(/\\n/g, "\n\n"); //ensures double spaces

            // Final cleaning
            cleanedContent = removeQuotes(fixNewLines(cleanedContent));

            if (this.isDryRun) {
                elizaLogger.info(
                    `Dry run: would have posted tweet: ${cleanedContent}`
                );
                return;
            }

            try {
                elizaLogger.log(`Posting new tweet:\n ${cleanedContent}`);
                await this.postTweet(
                    this.runtime,
                    this.client,
                    cleanedContent,
                    roomId,
                    cleanedContent,
                    this.twitterUsername
                );
            } catch (error) {
                elizaLogger.error("Error sending tweet:", error);
            }
        } catch (error) {
            elizaLogger.error("Error generating tweet:", error);
        }
    }

    private async generateTweetContent(
        tweetState: any,
        options?: {
            template?: string;
            context?: string;
        }
    ): Promise<string> {
        const context = composeContext({
            state: tweetState,
            template:
                options?.template ||
                this.runtime.character.templates?.twitterPostTemplate ||
                twitterPostTemplate,
        });

        const response = await generateText({
            runtime: this.runtime,
            context: options?.context || context,
            modelClass: ModelClass.SMALL,
        });
        elizaLogger.debug("generate tweet content response:\n" + response);

        // First clean up any markdown and newlines
        const cleanedResponse = response
            .replace(/```json\s*/g, "") // Remove ```json
            .replace(/```\s*/g, "") // Remove any remaining ```
            .replaceAll(/\\n/g, "\n")
            .trim();

        // Try to parse as JSON first
        try {
            const jsonResponse = JSON.parse(cleanedResponse);
            if (jsonResponse.text) {
                return this.trimTweetLength(jsonResponse.text);
            }
            if (typeof jsonResponse === "object") {
                const possibleContent =
                    jsonResponse.content ||
                    jsonResponse.message ||
                    jsonResponse.response;
                if (possibleContent) {
                    return this.trimTweetLength(possibleContent);
                }
            }
        } catch (error) {
            error.linted = true; // make linter happy since catch needs a variable

            // If JSON parsing fails, treat as plain text
            elizaLogger.debug("Response is not JSON, treating as plain text");
        }

        // If not JSON or no valid content found, clean the raw text
        return this.trimTweetLength(cleanedResponse);
    }

    // Helper method to ensure tweet length compliance
    private trimTweetLength(text: string, maxLength: number = 280): string {
        if (text.length <= maxLength) return text;

        // Try to cut at last sentence
        const lastSentence = text.slice(0, maxLength).lastIndexOf(".");
        if (lastSentence > 0) {
            return text.slice(0, lastSentence + 1).trim();
        }

        // Fallback to word boundary
        return (
            text.slice(0, text.lastIndexOf(" ", maxLength - 3)).trim() + "..."
        );
    }

    /**
     * Processes tweet actions (likes, retweets, quotes, replies). If isDryRun is true,
     * only simulates and logs actions without making API calls.
     */
    private async processTweetActions() {
        if (this.isProcessing) {
            elizaLogger.log("Already processing tweet actions, skipping");
            return null;
        }

        try {
            this.isProcessing = true;
            this.lastProcessTime = Date.now();

            elizaLogger.log("Processing tweet actions");

            if (this.isDryRun) {
                elizaLogger.log("Dry run mode: simulating tweet actions");
                return [];
            }

            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.twitterUsername,
                this.runtime.character.name,
                "twitter"
            );

            const homeTimeline =
                await this.client.fetchTimelineForActions(TIMELINE_FETCH_LIMIT);
            const results = [];

            for (const tweet of homeTimeline) {
                try {
                    // Skip if we've already processed this tweet
                    const memory =
                        await this.runtime.messageManager.getMemoryById(
                            stringToUuid(tweet.id + "-" + this.runtime.agentId)
                        );
                    if (memory) {
                        elizaLogger.log(
                            `Already processed tweet ID: ${tweet.id}`
                        );
                        continue;
                    }

                    const roomId = stringToUuid(
                        tweet.conversationId + "-" + this.runtime.agentId
                    );

                    const tweetState = await this.runtime.composeState(
                        {
                            userId: this.runtime.agentId,
                            roomId,
                            agentId: this.runtime.agentId,
                            content: { text: "", action: "" },
                        },
                        {
                            twitterUserName: this.twitterUsername,
                            currentTweet: `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})\nText: ${tweet.text}`,
                        }
                    );

                    const actionContext = composeContext({
                        state: tweetState,
                        template:
                            this.runtime.character.templates
                                ?.twitterActionTemplate ||
                            twitterActionTemplate,
                    });

                    const actionResponse = await generateTweetActions({
                        runtime: this.runtime,
                        context: actionContext,
                        modelClass: ModelClass.SMALL,
                    });

                    if (!actionResponse) {
                        elizaLogger.log(
                            `No valid actions generated for tweet ${tweet.id}`
                        );
                        continue;
                    }

                    const executedActions: string[] = [];

                    // Process each configured action
                    for (const actionConfig of TWITTER_ACTIONS) {
                        const actionType = actionConfig.tag
                            .toLowerCase()
                            .replace(/[[\]]/g, "");
                        if (
                            !actionConfig.active ||
                            !actionResponse[actionType]
                        ) {
                            continue;
                        }

                        const canExecute = await this.canExecuteAction(
                            this.runtime,
                            this.twitterUsername,
                            actionConfig
                        );
                        if (!canExecute) {
                            continue;
                        }

                        try {
                            let actionExecuted = false;
                            switch (actionConfig.tag) {
                                case "[LIKE]":
                                    actionExecuted =
                                        await this.executeLikeAction(tweet);
                                    break;
                                case "[RETWEET]":
                                    actionExecuted =
                                        await this.executeRetweetAction(tweet);
                                    break;
                                case "[QUOTE]":
                                    actionExecuted =
                                        await this.executeQuoteAction(tweet);
                                    break;
                                case "[REPLY]":
                                    actionExecuted =
                                        await this.executeReplyAction(tweet);
                                    break;
                            }

                            if (actionExecuted) {
                                await this.trackActionExecution(
                                    this.runtime,
                                    this.twitterUsername,
                                    actionConfig
                                );
                                executedActions.push(actionType);
                            }
                        } catch (error) {
                            elizaLogger.error(
                                `Error executing ${actionConfig.tag} for tweet ${tweet.id}:`,
                                error
                            );
                        }
                    }

                    // Add these checks before creating memory
                    await this.runtime.ensureRoomExists(roomId);
                    await this.runtime.ensureUserExists(
                        stringToUuid(tweet.userId),
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );
                    await this.runtime.ensureParticipantInRoom(
                        this.runtime.agentId,
                        roomId
                    );

                    // Then create the memory
                    await this.runtime.messageManager.createMemory({
                        id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                        userId: stringToUuid(tweet.userId),
                        content: {
                            text: tweet.text,
                            url: tweet.permanentUrl,
                            source: "twitter",
                            action: executedActions.join(","),
                        },
                        agentId: this.runtime.agentId,
                        roomId,
                        embedding: getEmbeddingZeroVector(),
                        createdAt: tweet.timestamp * 1000,
                    });

                    results.push({
                        tweetId: tweet.id,
                        parsedActions: actionResponse,
                        executedActions,
                    });
                } catch (error) {
                    elizaLogger.error(
                        `Error processing tweet ${tweet.id}:`,
                        error
                    );
                    continue;
                }
            }

            return results; // Return results array to indicate completion
        } catch (error) {
            elizaLogger.error("Error in processTweetActions:", error);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    private async canExecuteAction(
        runtime: IAgentRuntime,
        twitterUsername: string,
        action: TwitterActionConfig
    ): Promise<boolean> {
        if (!action.active) return Promise.resolve(false);

        if (action.delayBetweenExecutions > 0) {
            const lastAction = await runtime.cacheManager.get<{
                timestamp: number;
            }>(
                `twitter/${twitterUsername}/last_${action.tag.toLowerCase().replace(/[\[\]]/g, "")}_at`
            );

            const lastActionTime = lastAction?.timestamp ?? 0;
            const canExecute =
                Date.now() >
                lastActionTime + action.delayBetweenExecutions * 60 * 1000;

            if (!canExecute) {
                const minutesUntilNext = Math.ceil(
                    (lastActionTime +
                        action.delayBetweenExecutions * 60 * 1000 -
                        Date.now()) /
                        (60 * 1000)
                );
                elizaLogger.log(
                    `${action.tag} action locked for ${minutesUntilNext} more minutes`
                );
                return Promise.resolve(false);
            }
        }

        return Promise.resolve(true);
    }

    private trackActionExecution(
        runtime: IAgentRuntime,
        twitterUsername: string,
        action: TwitterActionConfig
    ) {
        runtime.cacheManager.set(
            `twitter/${twitterUsername}/last_${action.tag.toLowerCase().replace(/[[\]]/g, "")}_at`,
            {
                timestamp: Date.now(),
            }
        );
    }

    // Break out action execution into separate methods
    private async executeLikeAction(tweet: Tweet): Promise<boolean> {
        if (this.isDryRun) {
            elizaLogger.info(`Dry run: would have liked tweet ${tweet.id}`);
            return true;
        }

        await this.client.twitterClient.likeTweet(tweet.id);
        elizaLogger.log(`Liked tweet ${tweet.id}`);
        return true;
    }

    private async executeRetweetAction(tweet: Tweet): Promise<boolean> {
        if (this.isDryRun) {
            elizaLogger.info(`Dry run: would have retweeted tweet ${tweet.id}`);
            return true;
        }

        await this.client.twitterClient.retweet(tweet.id);
        elizaLogger.log(`Retweeted tweet ${tweet.id}`);
        return true;
    }

    private async buildTweetContext(tweet: Tweet) {
        // Build conversation thread for context
        const thread = await buildConversationThread(tweet, this.client);
        const formattedConversation = thread
            .map(
                (t) =>
                    `@${t.username} (${new Date(t.timestamp * 1000).toLocaleString()}): ${t.text}`
            )
            .join("\n\n");

        // Generate image descriptions if present
        const imageDescriptions = [];
        if (tweet.photos?.length > 0) {
            elizaLogger.log("Processing images in tweet for context");
            for (const photo of tweet.photos) {
                const description = await this.runtime
                    .getService<IImageDescriptionService>(
                        ServiceType.IMAGE_DESCRIPTION
                    )
                    .describeImage(photo.url);
                imageDescriptions.push(description);
            }
        }

        // Handle quoted tweet if present
        let quotedContent = "";
        if (tweet.quotedStatusId) {
            try {
                const quotedTweet = await this.client.twitterClient.getTweet(
                    tweet.quotedStatusId
                );
                if (quotedTweet) {
                    quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
                }
            } catch (error) {
                elizaLogger.error("Error fetching quoted tweet:", error);
            }
        }

        return {
            formattedConversation,
            imageContext:
                imageDescriptions.length > 0
                    ? `\nImages in Tweet:\n${imageDescriptions.map((desc, i) => `Image ${i + 1}: ${desc}`).join("\n")}`
                    : "",
            quotedContent,
        };
    }

    // Then update executeQuoteAction and executeReplyAction to use this helper:
    private async executeQuoteAction(tweet: Tweet): Promise<boolean> {
        if (this.isDryRun) {
            elizaLogger.info(
                `Dry run: would have posted quote tweet for ${tweet.id}`
            );
            return true;
        }

        const context = await this.buildTweetContext(tweet);

        // Compose rich state with all context
        const enrichedState = await this.runtime.composeState(
            {
                userId: this.runtime.agentId,
                roomId: stringToUuid(
                    tweet.conversationId + "-" + this.runtime.agentId
                ),
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    action: "QUOTE",
                },
            },
            {
                twitterUserName: this.twitterUsername,
                currentPost: `From @${tweet.username}: ${tweet.text}`,
                formattedConversation: context.formattedConversation,
                imageContext: context.imageContext,
                quotedContent: context.quotedContent,
            }
        );

        const quoteContent = await this.generateTweetContent(enrichedState, {
            template:
                this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                twitterMessageHandlerTemplate,
        });

        if (!quoteContent) {
            elizaLogger.error("Failed to generate valid quote tweet content");
            return false;
        }

        elizaLogger.log("Generated quote tweet content:", quoteContent);

        // Send the tweet through request queue
        const result = await this.client.requestQueue.add(
            async () =>
                await this.client.twitterClient.sendQuoteTweet(
                    quoteContent,
                    tweet.id
                )
        );

        const body = await result.json();

        if (body?.data?.create_tweet?.tweet_results?.result) {
            elizaLogger.log("Successfully posted quote tweet");
            this.trackActionExecution(this.runtime, this.twitterUsername, {
                tag: "[QUOTE]",
                description: "Can add substantial domain expertise",
                active: true,
                maxExecutionsPerRun: 1,
                delayBetweenExecutions: 72, // 72 minutes between quotes
                threshold: 9.5,
            });

            // Cache generation context for debugging
            await this.runtime.cacheManager.set(
                `twitter/quote_generation_${tweet.id}.txt`,
                `Context:\n${enrichedState}\n\nGenerated Quote:\n${quoteContent}`
            );
            return true;
        } else {
            elizaLogger.error("Quote tweet creation failed:", body);
            return false;
        }
    }

    private async executeReplyAction(tweet: Tweet): Promise<boolean> {
        if (this.isDryRun) {
            elizaLogger.info(
                `Dry run: reply to tweet ${tweet.id} would have been: ${tweet.text}`
            );
            return true;
        }

        const context = await this.buildTweetContext(tweet);

        // Compose rich state with all context
        const enrichedState = await this.runtime.composeState(
            {
                userId: this.runtime.agentId,
                roomId: stringToUuid(
                    tweet.conversationId + "-" + this.runtime.agentId
                ),
                agentId: this.runtime.agentId,
                content: { text: tweet.text, action: "" },
            },
            {
                twitterUserName: this.twitterUsername,
                currentPost: `From @${tweet.username}: ${tweet.text}`,
                formattedConversation: context.formattedConversation,
                imageContext: context.imageContext,
                quotedContent: context.quotedContent,
            }
        );

        // Generate and clean the reply content
        const replyText = await this.generateTweetContent(enrichedState, {
            template:
                this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                twitterMessageHandlerTemplate,
        });

        if (!replyText) {
            elizaLogger.error("Failed to generate valid reply content");
            return false;
        }

        elizaLogger.debug("Final reply text to be sent:", replyText);

        let result;

        if (replyText.length > DEFAULT_MAX_TWEET_LENGTH) {
            result = await this.handleNoteTweet(
                this.client,
                this.runtime,
                replyText,
                tweet.id
            );
        } else {
            result = await this.sendStandardTweet(
                this.client,
                replyText,
                tweet.id
            );
        }

        if (result) {
            elizaLogger.log("Successfully posted reply tweet");
            this.trackActionExecution(this.runtime, this.twitterUsername, {
                tag: "[REPLY]",
                description: "Can contribute meaningful, expert-level insight",
                active: true,
                maxExecutionsPerRun: 0,
                delayBetweenExecutions: 0,
                threshold: 9.5,
            });

            // Cache generation context for debugging
            await this.runtime.cacheManager.set(
                `twitter/reply_generation_${tweet.id}.txt`,
                `Context:\n${enrichedState}\n\nGenerated Reply:\n${replyText}`
            );
            return true;
        } else {
            elizaLogger.error("Tweet reply creation failed");
            return false;
        }
    }

    async stop() {
        this.stopProcessingActions = true;
    }
}
