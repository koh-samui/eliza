import {
    composeContext,
    elizaLogger,
    generateText,
    ModelClass,
    stringToUuid,
    IAgentRuntime,
} from "@elizaos/core";
import { Scraper, SearchMode, Tweet } from "agent-twitter-client";
import { ScheduledTweet, ScheduledTweetContent } from "./types.js";

const SOLANA_ACCOUNTS = [
    'S0LBigFinance',
    'magFOMO',
    'StepDevInsights',
    'SolanaFloor',
    'solana_daily',
    'SolanaStatus',
    'solananew'
];

const dailyNewsSummaryTemplate = `
# Task: Summarize the most important Solana news of the day

Context: You are analyzing tweets from key Solana ecosystem accounts. Create a concise summary of the most significant developments.

Guidelines:
- Focus on major Solana ecosystem updates, market moves, and protocol developments
- Avoid duplicate information and minor updates
- Prioritize verified information from these trusted Solana sources
- Maintain a neutral, factual tone
- Format the summary in 2-3 clear bullet points
- Keep total length under 240 characters

Tweets to analyze:
{{tweets}}

Write a concise summary in the following format:
📰 Daily Solana News:
• [First key development]
• [Second key development]
• [Third key development if space permits]
`;

export const dailyNewsTweet: ScheduledTweet = {
    id: "daily-news",
    frequency: "daily",
    timeCondition: {
        hour: 9, // 9 PM
    },
    generateContent: async (runtime: IAgentRuntime): Promise<ScheduledTweetContent> => {
        let scraper: Scraper | null = null;
        try {
            // Initialize scraper
            scraper = new Scraper();
            elizaLogger.info("Initializing Twitter scraper...");
            // Debug log available methods
            elizaLogger.debug("Available scraper methods:", Object.keys(scraper));

            // Get credentials from environment
            const username = process.env.TWITTER_USERNAME;
            const password = process.env.TWITTER_PASSWORD;
            const email = process.env.TWITTER_EMAIL;

            if (!username || !password || !email) {
                throw new Error("Missing Twitter credentials in environment");
            }

            // Login to Twitter
            elizaLogger.info("Attempting Twitter login...");
            await scraper.login(username, password, email);
            elizaLogger.info("Successfully logged into Twitter");

            // Modified search to use fetchSearchTweets instead
            const searchResults = [];
            for (const account of SOLANA_ACCOUNTS) {
                elizaLogger.info(`Fetching tweets for account: ${account}`);
                try {
                    const accountTweets = await scraper.fetchSearchTweets(
                        `from:${account} -is:retweet`,
                        50,
                        SearchMode.Latest
                    );
                    elizaLogger.info(`Found ${accountTweets?.tweets?.length || 0} tweets for ${account}`);
                    if (accountTweets?.tweets?.length) {
                        searchResults.push(...accountTweets.tweets);
                    }
                } catch (error) {
                    elizaLogger.error(`Error fetching tweets for ${account}:`, error);
                }
            }

            elizaLogger.info(`Total tweets found before filtering: ${searchResults.length}`);

            // Filter tweets from the last 24 hours
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            const oneDayAgoTimestamp = Math.floor(oneDayAgo.getTime() / 1000); // Convert to Unix timestamp

            // Debug log some raw tweets
            searchResults.slice(0, 3).forEach((tweet, i) => {
                elizaLogger.info(`Sample tweet ${i + 1}:`, {
                    username: tweet.username,
                    timestamp: tweet.timestamp,
                    date: new Date(tweet.timestamp * 1000).toISOString(), // Convert Unix timestamp to readable date
                    text: tweet.text?.slice(0, 100) + '...'
                });
            });

            const recentTweets = searchResults.filter((tweet) => {
                if (!tweet?.timestamp) {
                    elizaLogger.warn(`Tweet missing timestamp:`, tweet);
                    return false;
                }
                try {
                    // Compare Unix timestamps directly
                    const isRecent = tweet.timestamp > oneDayAgoTimestamp;
                    if (isRecent) {
                        const tweetDate = new Date(tweet.timestamp * 1000);
                        elizaLogger.info(`Found recent tweet from ${tweet.username} at ${tweetDate.toISOString()}`);
                    }
                    return isRecent;
                } catch (e) {
                    elizaLogger.warn(`Invalid timestamp for tweet: ${tweet.text}`);
                    return false;
                }
            });

            elizaLogger.info(`Found ${recentTweets.length} tweets from the last 24 hours`);

            if (!recentTweets.length) {
                elizaLogger.warn("No recent tweets found from specified Solana accounts");
                return { content: "" };
            }

            // Format tweets for the template
            const formattedTweets = recentTweets
                .map((tweet) => `@${tweet.username || 'unknown'}: ${tweet.text || ''}`)
                .join("\n\n");

            // Create a room ID for this summary
            const roomId = stringToUuid("daily-news-summary");

            // Generate state for the context
            const state = await runtime.composeState(
                {
                    userId: runtime.agentId,
                    roomId: roomId,
                    agentId: runtime.agentId,
                    content: {
                        text: formattedTweets,
                        action: "SUMMARIZE",
                    },
                },
                {
                    tweets: formattedTweets,
                }
            );

            // Generate summary using runtime's generateText
            let summary;
            if (runtime.generateText) {
                // Add the tweets to the template
                const templateWithTweets = dailyNewsSummaryTemplate.replace('{{tweets}}', formattedTweets);

                summary = await runtime.generateText({
                    context: {
                        template: templateWithTweets, // Use the template with tweets inserted
                        state
                    },
                    modelClass: ModelClass.SMALL
                });
            } else {
                elizaLogger.warn("No generateText available, using template directly");
                summary = dailyNewsSummaryTemplate
                    .replace('{{tweets}}', formattedTweets);
            }

            // Clean and format the summary
            const cleanedSummary = summary
                .replace(/```json\s*|\s*```/g, "") // Remove JSON markers
                .replace(/^['"](.*)['"]$/g, "$1") // Remove outer quotes
                .replace(/\\n/g, "\n") // Fix newlines
                .trim();

            // Validate tweet length (Twitter's limit is 280 characters)
            if (cleanedSummary.length > 280) {
                elizaLogger.warn("Generated summary exceeds Twitter's 280 character limit. Truncating...");
                const truncatedSummary = cleanedSummary.slice(0, 277) + "...";
                elizaLogger.info("Truncated summary:", truncatedSummary);
                return {
                    content: truncatedSummary,
                    posted: false
                };
            }

            let tweetPosted = false;
            // Post the summary to Twitter
            try {
                elizaLogger.info("Attempting to post summary to Twitter...");
                // Log available methods and properties
                const scraperMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(scraper));
                elizaLogger.info("Available scraper methods:", scraperMethods);
                elizaLogger.info("Scraper properties:", Object.keys(scraper));

                // Try to post tweet using auth token
                if (scraper.auth?.token) {
                    elizaLogger.info("Using auth token to post tweet");
                    const response = await fetch('https://api.twitter.com/2/tweets', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${scraper.auth.token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            text: cleanedSummary
                        })
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(`Twitter API error: ${JSON.stringify(error)}`);
                    }

                    elizaLogger.info("Successfully posted summary to Twitter");
                    tweetPosted = true;
                } else {
                    // Try using the scraper's built-in methods
                    const tweetMethods = ['sendTweet', 'tweet', 'postTweet', 'createTweet']
                        .find(method => typeof scraper[method] === 'function');

                    if (tweetMethods) {
                        elizaLogger.info(`Using scraper.${tweetMethods} to post tweet`);
                        await scraper[tweetMethods](cleanedSummary);
                        elizaLogger.info("Successfully posted summary to Twitter");
                        tweetPosted = true;
                    } else {
                        throw new Error("No available tweet method found on scraper");
                    }
                }
            } catch (postError) {
                elizaLogger.error("Error posting to Twitter:", postError);
                if (postError instanceof Error) {
                    elizaLogger.error("Tweet posting error details:", postError.message);
                    elizaLogger.error("Stack trace:", postError.stack);
                }
                // Log detailed scraper info
                elizaLogger.debug("Scraper details:", {
                    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(scraper)),
                    properties: Object.keys(scraper),
                    hasAuth: !!scraper.auth,
                    authToken: scraper.auth?.token ? 'present' : 'missing',
                    hasClient: !!scraper.client,
                    clientProperties: scraper.client ? Object.keys(scraper.client) : []
                });
            }

            return {
                content: cleanedSummary,
                posted: tweetPosted
            };
        } catch (error) {
            elizaLogger.error("Error generating daily news tweet:", error);
            if (error instanceof Error) {
                elizaLogger.error("Error details:", error.message);
                elizaLogger.error("Stack trace:", error.stack);
            }
            return { content: "", posted: false };
        } finally {
            // Always try to logout
            if (scraper) {
                try {
                    await scraper.logout();
                    elizaLogger.info("Successfully logged out from Twitter");
                } catch (logoutError) {
                    elizaLogger.warn("Error during Twitter logout:", logoutError);
                }
            }
        }
    },
};

export async function testDailyNewsSummary(runtime: Partial<IAgentRuntime>) {
    elizaLogger.info("Testing daily news summary...");
    const result = await dailyNewsTweet.generateContent(runtime as IAgentRuntime);

    if (result.content) {
        elizaLogger.info("Generated summary:", result.content);
        if (result.posted) {
            elizaLogger.info("Summary has been successfully posted to Twitter");
        } else {
            elizaLogger.warn("Summary was generated but could not be posted to Twitter");
        }
        return result.content;
    } else {
        elizaLogger.warn("No summary generated");
        return "";
    }
}
