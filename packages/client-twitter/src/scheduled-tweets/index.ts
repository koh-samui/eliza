import { dailyTopKolsTweet } from "./daily-top-kols";
import { monthlyTopKolsTweet } from "./monthly-top-kols";
import { ScheduledTweet } from "./types";
import { weeklyTopKolsTweet } from "./weekly-top-kols";

// Register all scheduled tweets here
export const scheduledTweets: ScheduledTweet[] = [
    dailyTopKolsTweet,
    weeklyTopKolsTweet,
    monthlyTopKolsTweet,
    // Add more scheduled tweets here
];
