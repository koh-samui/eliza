import {
    composeContext,
    elizaLogger,
    generateText,
    ModelClass,
    stringToUuid,
    IAgentRuntime,
} from "@elizaos/core";
import { Scraper, SearchMode, Tweet, ScheduledTweet } from "agent-twitter-client";

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
        hour: 21, // 9 PM
    },
    generateContent: async (runtime: IAgentRuntime) => {
        let scraper: Scraper | null = null;
        try {
            // Initialize scraper
            scraper = new Scraper();
            elizaLogger.info("Initializing Twitter scraper...");

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

            // Fetch tweets from accounts
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

            // Filter tweets from the last 24 hours
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            const oneDayAgoTimestamp = Math.floor(oneDayAgo.getTime() / 1000);

            const recentTweets = searchResults.filter((tweet) => {
                if (!tweet?.timestamp) return false;
                return tweet.timestamp > oneDayAgoTimestamp;
            });

            if (!recentTweets.length) {
                elizaLogger.warn("No recent tweets found from specified Solana accounts");
                return null;
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

            // Generate summary
            let summary;
            if (runtime.generateText) {
                const templateWithTweets = dailyNewsSummaryTemplate.replace('{{tweets}}', formattedTweets);

                summary = await runtime.generateText({
                    context: {
                        template: templateWithTweets,
                        state
                    },
                    modelClass: ModelClass.SMALL
                });
            } else {
                elizaLogger.warn("No generateText available, using template directly");
                summary = dailyNewsSummaryTemplate.replace('{{tweets}}', formattedTweets);
            }

            // Clean and format the summary
            const cleanedSummary = summary
                .replace(/```json\s*|\s*```/g, "")
                .replace(/^['"](.*)['"]$/g, "$1")
                .replace(/\\n/g, "\n")
                .trim();

            if (cleanedSummary.length > 280) {
                elizaLogger.warn("Generated summary exceeds 280 character limit. Truncating...");
                return { content: cleanedSummary.slice(0, 277) + "..." };
            }

            return { content: cleanedSummary };

        } catch (error) {
            elizaLogger.error("Error generating daily news tweet:", error);
            if (error instanceof Error) {
                elizaLogger.error("Error details:", error.message);
                elizaLogger.error("Stack trace:", error.stack);
            }
            throw error;
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