import { elizaLogger } from "@elizaos/core";
import { TopWalletsAPI } from "@elizaos/plugin-topwallets";
import { ScheduledTweet } from "./types";

export const monthlyTopKolsTweet: ScheduledTweet = {
    id: "monthly-top-kols",
    frequency: "monthly",
    timeCondition: {
        hour: 11, // after 11 AM
        dayOfMonth: 1, // First day of the month
    },
    generateContent: async () => {
        try {
            const topWalletsAPI = TopWalletsAPI.getInstance();
            const [response, imageBuffer] = await Promise.all([
                topWalletsAPI.getTopKols(100),
                topWalletsAPI.getTopKolsPicture("30d"),
            ]);

            // Sort by 30d score and get top 3, using PnL as tiebreaker
            const top3Kols = response.data
                .sort((a, b) => {
                    const scoreA = a["30d"].score;
                    const scoreB = b["30d"].score;
                    if (scoreA === scoreB) {
                        return (
                            b["30d"].combinedPnlRaw - a["30d"].combinedPnlRaw
                        );
                    }
                    return scoreB - scoreA;
                })
                .slice(0, 3);

            // Generate tweet text
            const tweetLines = [
                "🌟 Monthly Top 3 KOLs - Best performers of the past 30 days",
                "", // Empty line for spacing
            ];

            const emojis = ["🥇", "🥈", "🥉"];

            top3Kols.forEach((kol, index) => {
                const data = kol["30d"];
                const handle = data.twitter_url
                    ? `@${data.twitter_url.split("/").pop()}`
                    : data.formattedAddress.slice(0, 8);
                const winRate = `${data.winrate}%`;
                const pnl = data.combinedPnl;

                tweetLines.push(
                    `${emojis[index]} [${data.score}] ${handle} - ${winRate} WR - ${pnl} PnL`
                );
            });

            // Add empty line and link
            tweetLines.push("");
            tweetLines.push("See full standings at @TopwalletsAI");

            return {
                content: tweetLines.join("\n"),
                mediaData: [
                    {
                        data: imageBuffer,
                        mediaType: "image/png",
                    },
                ],
            };
        } catch (error) {
            elizaLogger.error(
                "Error generating monthly top KOLs tweet:",
                error
            );
            throw error;
        }
    },
};
