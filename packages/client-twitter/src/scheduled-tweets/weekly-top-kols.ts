import { elizaLogger } from "@elizaos/core";
import { TopWalletsAPI } from "@elizaos/plugin-topwallets";
import { ScheduledTweet } from "./types";

const formatPnl = (pnl: number) => {
    if (Math.abs(pnl) >= 1000000) {
        return `$${(pnl / 1000000).toFixed(1)}M`;
    } else if (Math.abs(pnl) >= 1000) {
        return `$${(pnl / 1000).toFixed(1)}K`;
    }
    return `$${pnl.toFixed(0)}`;
};

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

            // Sort by 7d score and get top 3
            const top3Kols = response.data
                .sort((a, b) => b["7d"].score - a["7d"].score)
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
                const pnl = formatPnl(data.combinedPnlRaw);

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
