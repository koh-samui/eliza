import { IAgentRuntime } from "@elizaos/core";

export interface ScheduledTweetContent {
    content: string;
    posted?: boolean;
}

export type TimeCondition = {
    hour: number;
    minute?: number;
    dayOfWeek?: number; // 0-6 for Sunday-Saturday
    dayOfMonth?: number; // 1-31
};

export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduledTweet {
    id: string;
    frequency: string;
    timeCondition: {
        hour: number;
    };
    generateContent: (runtime: IAgentRuntime) => Promise<ScheduledTweetContent>;
    shouldRun?: () => Promise<boolean>; // Optional custom condition
}
