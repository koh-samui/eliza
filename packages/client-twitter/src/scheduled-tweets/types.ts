import { IAgentRuntime } from "@elizaos/core";

export type ScheduledTweetContent = {
    content: string;
    mediaData?: { data: Buffer; mediaType: string }[] | null;
};

export type TimeCondition = {
    hour: number;
    minute?: number;
    dayOfWeek?: number; // 0-6 for Sunday-Saturday
    dayOfMonth?: number; // 1-31
};

export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduledTweet {
    id: string;
    frequency: Frequency;
    timeCondition: TimeCondition;
    generateContent: (runtime: IAgentRuntime) => Promise<ScheduledTweetContent>;
    shouldRun?: () => Promise<boolean>; // Optional custom condition
}
