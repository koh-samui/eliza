import { elizaLogger } from "@elizaos/core";
import { TopWalletsAPI } from "@elizaos/plugin-topwallets";
import { ScheduledTweet } from "./types";

export const dailyTopKolsTweet: ScheduledTweet = {
    id: "daily-top-kols",
    frequency: "daily",
    timeCondition: {
        hour: 18, // after 10 AM
    },
    generateContent: async () => {
        try {
            const topWalletsAPI = TopWalletsAPI.getInstance();
            const [response, imageBuffer] = await Promise.all([
                topWalletsAPI.getTopKols(100),
                topWalletsAPI.getTopKolsPicture(),
            ]);

            // Sort by 1d score and get top 3, using PnL as tiebreaker
            const top3Kols = response.data
                .sort((a, b) => {
                    const scoreA = a["1d"].score;
                    const scoreB = b["1d"].score;
                    if (scoreA === scoreB) {
                        return b["1d"].realizedPnlRaw - a["1d"].realizedPnlRaw;
                    }
                    return scoreB - scoreA;
                })
                .slice(0, 3);

            // Generate tweet text
            const tweetLines = [
                "Top 3 KOLs by trading stats in the last 24H",
                "", // Empty line for spacing
            ];

            const emojis = ["🥇", "🥈", "🥉"];

            top3Kols.forEach((kol, index) => {
                const data = kol["1d"];
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
            elizaLogger.error("Error generating daily top KOLs tweet:", error);
            throw error;
        }
    },
};
