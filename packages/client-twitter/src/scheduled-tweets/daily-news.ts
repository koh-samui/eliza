import {
    composeContext,
    elizaLogger,
    generateText,
    ModelClass,
    stringToUuid,
} from "@elizaos/core";
import { Scraper, SearchMode } from "agent-twitter-client";
import { ScheduledTweet } from "./types";

const dailyNewsSummaryTemplate = `
# Task: Summarize the most important crypto news of the day

Context: You are analyzing a collection of tweets about cryptocurrency news. Create a concise summary of the most significant developments.

Guidelines:
- Focus on major market moves, significant protocol updates, or important industry news
- Avoid duplicate information and minor updates
- Prioritize verified information from reliable sources
- Maintain a neutral, factual tone
- Format the summary in 2-3 clear bullet points
- Keep total length under 240 characters

Tweets to analyze:
{{tweets}}

Write a concise summary in the following format:
📰 Daily Crypto News Summary:
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
    generateContent: async (runtime) => {
        try {
            // Initialize scraper
            const scraper = new Scraper();

            // Get credentials from environment
            const username = process.env.TWITTER_USERNAME;
            const password = process.env.TWITTER_PASSWORD;
            const email = process.env.TWITTER_EMAIL;

            if (!username || !password || !email) {
                throw new Error("Missing Twitter credentials in environment");
            }

            // Login to Twitter
            await scraper.login(username, password, email);

            // Search for tweets from the last 24 hours
            const searchQuery = "crypto OR bitcoin OR ethereum -is:retweet";
            const searchResults = await scraper.fetchSearchTweets(
                searchQuery,
                100, // max results
                SearchMode.Latest
            );

            if (!searchResults?.tweets?.length) {
                elizaLogger.warn("No tweets found for daily news summary");
                return null;
            }

            // Format tweets for the template
            const formattedTweets = searchResults.tweets
                .map((tweet) => `@${tweet.username}: ${tweet.text}`)
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

            // Generate summary using LLM
            const context = composeContext({
                state,
                template: dailyNewsSummaryTemplate,
            });

            const summary = await generateText({
                runtime: runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            // Clean and format the summary
            const cleanedSummary = summary
                .replace(/```json\s*|\s*```/g, "") // Remove JSON markers
                .replace(/^['"](.*)['"]$/g, "$1") // Remove outer quotes
                .replace(/\\n/g, "\n") // Fix newlines
                .trim();

            // Logout after we're done
            await scraper.logout();

            return {
                content: cleanedSummary,
            };
        } catch (error) {
            elizaLogger.error("Error generating daily news tweet:", error);
            throw error;
        }
    },
};
