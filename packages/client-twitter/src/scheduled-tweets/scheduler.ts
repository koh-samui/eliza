import { elizaLogger, IAgentRuntime } from "@elizaos/core";
import { ScheduledTweet, ScheduledTweetContent } from "./types";

export class TweetScheduler {
    constructor(
        private tweets: ScheduledTweet[],
        private runtime: IAgentRuntime,
        private twitterUsername: string
    ) {}

    private async getLastRunTime(tweetId: string): Promise<Date | null> {
        const cacheKey = `twitter/${this.twitterUsername}/scheduled/${tweetId}`;
        const cached = await this.runtime.cacheManager.get<{
            timestamp: number;
        }>(cacheKey);

        return cached ? new Date(cached.timestamp) : null;
    }

    private async setLastRunTime(tweetId: string): Promise<void> {
        const cacheKey = `twitter/${this.twitterUsername}/scheduled/${tweetId}`;
        await this.runtime.cacheManager.set(cacheKey, {
            timestamp: Date.now(),
        });
    }

    async shouldRunTweet(tweet: ScheduledTweet): Promise<boolean> {
        const now = new Date();
        const lastRun = await this.getLastRunTime(tweet.id);

        // Check custom condition if exists
        if (tweet.shouldRun) {
            const customCheck = await tweet.shouldRun();
            if (!customCheck) return false;
        }

        // Check time condition
        if (now.getHours() < tweet.timeCondition.hour) return false;
        if (
            tweet.timeCondition.minute &&
            now.getMinutes() < tweet.timeCondition.minute
        )
            return false;
        if (
            tweet.timeCondition.dayOfWeek &&
            now.getDay() !== tweet.timeCondition.dayOfWeek
        )
            return false;
        if (
            tweet.timeCondition.dayOfMonth &&
            now.getDate() !== tweet.timeCondition.dayOfMonth
        )
            return false;

        // Check frequency
        if (lastRun) {
            const sameDay = lastRun.toDateString() === now.toDateString();
            const sameWeek =
                lastRun.getTime() > now.getTime() - 7 * 24 * 60 * 60 * 1000;
            const sameMonth =
                lastRun.getMonth() === now.getMonth() &&
                lastRun.getFullYear() === now.getFullYear();

            switch (tweet.frequency) {
                case "daily":
                    if (sameDay) return false;
                    break;
                case "weekly":
                    if (sameWeek) return false;
                    break;
                case "monthly":
                    if (sameMonth) return false;
                    break;
            }
        }

        return true;
    }

    async getNextScheduledTweet(): Promise<ScheduledTweetContent | null> {
        for (const tweet of this.tweets) {
            if (await this.shouldRunTweet(tweet)) {
                const content = await tweet.generateContent();
                await this.setLastRunTime(tweet.id);
                elizaLogger.log(
                    `Scheduled tweet ${tweet.id} is ready to run at ${new Date().toLocaleString()}`
                );
                return content;
            }
        }
        return null;
    }
}
