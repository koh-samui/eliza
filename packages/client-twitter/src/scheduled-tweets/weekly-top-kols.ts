import { elizaLogger } from "@elizaos/core";
import { TopWalletsAPI } from "@elizaos/plugin-topwallets";
import { ScheduledTweet } from "./types";

export const weeklyTopKolsTweet: ScheduledTweet = {
    id: "weekly-top-kols",
    frequency: "weekly",
    timeCondition: {
        hour: 8, // after 8 AM
        dayOfWeek: 1, // Monday (0 is Sunday, 1 is Monday)
    },
    generateContent: async () => {
        try {
            const topWalletsAPI = TopWalletsAPI.getInstance();
            const [response, imageBuffer] = await Promise.all([
                topWalletsAPI.getTopKols(100),
                topWalletsAPI.getTopKolsPicture("7d"),
            ]);

            // Sort by 7d score and get top 3, using PnL as tiebreaker
            const top3Kols = response.data
                .sort((a, b) => {
                    const scoreA = a["7d"].score;
                    const scoreB = b["7d"].score;
                    if (scoreA === scoreB) {
                        return b["7d"].realizedPnlRaw - a["7d"].realizedPnlRaw;
                    }
                    return scoreB - scoreA;
                })
                .slice(0, 3);

            // Generate tweet text
            const tweetLines = [
                "🏆 Weekly Top 3 KOLs by trading performance",
                "", // Empty line for spacing
            ];

            const emojis = ["🥇", "🥈", "🥉"];

            top3Kols.forEach((kol, index) => {
                const data = kol["7d"];
                const handle = data.twitter_url
                    ? `@${data.twitter_url.split("/").pop()}`
                    : data.formattedAddress.slice(0, 8);
                const winRate = `${data.winrate}%`;
                const pnl = data.realizedPnl;

                tweetLines.push(
                    `${emojis[index]} ${handle} | ${winRate} WR - ${pnl} PnL`
                );
            });

            // Add empty line and link
            tweetLines.push("");
            tweetLines.push(
                "See full standings at https://www.topwallets.ai/top-kols"
            );

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
            elizaLogger.error("Error generating weekly top KOLs tweet:", error);
            throw error;
        }
    },
};
