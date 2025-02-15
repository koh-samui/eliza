import {
    composeContext,
    elizaLogger,
    generateText,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
} from "@elizaos/core";
import { Scraper, SearchMode } from "agent-twitter-client";
import { ScheduledTweet } from "./types";

const SOLANA_ACCOUNTS = [
    // Primary sources
    "Solana",
    "SolanaFndn",
    "SolanaStatus",
    // Key ecosystem accounts
    "solana_daily",
    "SolanaNews",
    "StepDevInsights",
    "SolanaFloor",
    "DeFiLlama",
];

const topStorySummaryTemplate = `
# Task: Identify and analyze the most significant Solana development of the day

Context: You are a Solana ecosystem analyst. Identify the single most important story or development from today's tweets and create an in-depth analysis thread about it.

Guidelines:
- Focus on the highest-impact development only (e.g., major protocol launches, significant partnerships, network upgrades)
- Create a thread with 3 tweets:
  1. Headline and key fact
  2. Technical details or metrics
  3. Impact analysis and implications
- Include relevant metrics when available
- Use clear, professional language
- Add contextual hashtags
- Each tweet must be under 280 characters
- Start with 🚨 for breaking news or 📢 for major announcements

Tweets to analyze:
{{tweets}}

Format the thread as follows:
[Tweet 1: Breaking news headline and core fact]
[Tweet 2: Key details, metrics, or technical aspects]
[Tweet 3: Analysis of impact on Solana ecosystem]
`;

export const enhancedDailyNewsTweet: ScheduledTweet = {
    id: "enhanced-daily-news",
    frequency: "daily",
    timeCondition: {
        hour: 20, // 8 PM
    },
    generateContent: async (runtime: IAgentRuntime) => {
        let scraper: Scraper | null = null;
        try {
            scraper = new Scraper();
            elizaLogger.info("Initializing Twitter scraper for top story...");

            const username = process.env.SCRAPER_TWITTER_USERNAME;
            const password = process.env.SCRAPER_TWITTER_PASSWORD;
            const email = process.env.SCRAPER_TWITTER_EMAIL;

            if (!username || !password || !email) {
                throw new Error("Missing Twitter credentials");
            }

            await scraper.login(username, password, email);
            elizaLogger.info("Twitter login successful");

            // Fetch tweets and track engagement metrics
            const searchResults = [];
            for (const account of SOLANA_ACCOUNTS) {
                elizaLogger.info(`Fetching tweets from ${account}`);
                try {
                    const accountTweets = await scraper.fetchSearchTweets(
                        `from:${account} -is:retweet`,
                        50,
                        SearchMode.Latest
                    );
                    if (accountTweets?.tweets?.length) {
                        // Add engagement score to help identify important topics
                        const tweetsWithEngagement = accountTweets.tweets.map(tweet => ({
                            ...tweet,
                            engagementScore: (tweet.likes || 0) * 1 + (tweet.retweets || 0) * 2
                        }));
                        searchResults.push(...tweetsWithEngagement);
                    }
                } catch (error) {
                    elizaLogger.error(`Error fetching ${account} tweets:`, error);
                }
            }

            // Filter last 24 hours
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            const oneDayAgoTimestamp = Math.floor(oneDayAgo.getTime() / 1000);

            const recentTweets = searchResults.filter(
                tweet => tweet?.timestamp && tweet.timestamp > oneDayAgoTimestamp
            );

            if (!recentTweets.length) {
                elizaLogger.warn("No recent tweets found");
                return null;
            }

            // Sort by engagement score to prioritize important topics
            recentTweets.sort((a, b) => b.engagementScore - a.engagementScore);

            // Format tweets with metadata and engagement
            const formattedTweets = recentTweets
                .map(tweet => {
                    const date = new Date(tweet.timestamp! * 1000);
                    return `@${tweet.username} (${date.toISOString()}): ${tweet.text}
                    Engagement: ${tweet.engagementScore} (${tweet.likes} likes, ${tweet.retweets} RTs)
                    ---`;
                })
                .join("\n\n");

            const roomId = stringToUuid("top-story-analysis");
            
            const state = await runtime.composeState(
                {
                    userId: runtime.agentId,
                    roomId: roomId,
                    agentId: runtime.agentId,
                    content: {
                        text: formattedTweets,
                        action: "ANALYZE_TOP_STORY",
                    },
                },
                {
                    tweets: formattedTweets,
                }
            );

            const templateWithTweets = topStorySummaryTemplate.replace(
                "{{tweets}}",
                formattedTweets
            );

            const context = composeContext({
                state,
                template: templateWithTweets,
            });

            const threadContent = await generateText({
                runtime,
                context,
                modelClass: ModelClass.MEDIUM,
            });

            // Split and clean thread content
            const tweets = threadContent
                .split("\n")
                .filter(tweet => tweet.trim().length > 0)
                .map(tweet => tweet.trim())
                .filter(tweet => tweet.length <= 280);

            return {
                content: tweets[0], // First tweet
                threadContent: tweets.slice(1), // Rest of the thread (2 more tweets)
            };

        } catch (error) {
            elizaLogger.error("Error generating top story analysis:", error);
            throw error;
        } finally {
            if (scraper) {
                try {
                    await scraper.logout();
                } catch (error) {
                    elizaLogger.warn("Error during logout:", error);
                }
            }
        }
    },
}; 