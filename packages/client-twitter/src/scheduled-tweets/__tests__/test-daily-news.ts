import { testDailyNewsSummary } from '../daily-news.js';
import {
    elizaLogger,
    IAgentRuntime,
    ModelProviderName,
    IDatabaseAdapter,
    stringToUuid,
    ModelClass
} from '@elizaos/core';

async function main() {
    try {
        // Load environment variables
        const username = process.env.TWITTER_USERNAME;
        const password = process.env.TWITTER_PASSWORD;
        const email = process.env.TWITTER_EMAIL;

        if (!username || !password || !email) {
            throw new Error("Missing Twitter credentials in environment");
        }

        // Create a more complete mock runtime object
        const runtime: Partial<IAgentRuntime> = {
            agentId: stringToUuid('test-agent'),
            modelProvider: ModelProviderName.OPENAI,
            token: process.env.OPENAI_API_KEY || 'test-token',
            // Create a minimal mock database adapter
            databaseAdapter: {
                db: null,
                init: async () => {},
                getAccountById: async () => null,
                createAccount: async () => null,
                updateAccount: async () => null,
                deleteAccount: async () => {},
                getAccounts: async () => [],
            } as unknown as IDatabaseAdapter,
            // Add the composeState method with more context
            composeState: async (state: any, variables: any) => ({
                ...state,
                variables,
                userId: stringToUuid('test-user'),
                roomId: stringToUuid('test-room'),
                agentId: stringToUuid('test-agent'),
                // Add Twitter-specific context
                twitterCredentials: {
                    username,
                    password,
                    email
                }
            }),
            // Add proper model configuration
            modelConfig: {
                modelEndpointOverride: 'gpt-3.5-turbo',
                modelProvider: ModelProviderName.OPENAI,
                modelClass: ModelClass.SMALL,
                temperature: 0.7,
                maxTokens: 500
            },
            // Add generateText implementation
            generateText: async ({ context, modelClass }) => {
                elizaLogger.info("Generating summary with template:", context.template);
                // For testing, return a mock summary
                return `📰 Daily Solana News:
• Solana DEX volume hits $81B, leading blockchain trading
• TRUMP memecoin leads SOL volume at $4.2B
• Raydium tops active wallets in Solana DApps`;
            }
        };

        elizaLogger.info("Starting daily news test...");
        elizaLogger.info("Looking for tweets from Solana accounts: S0LBigFinance, magFOMO, StepDevInsights, etc...");

        const summary = await testDailyNewsSummary(runtime);

        if (summary) {
            console.log("\n=== Generated Summary ===\n");
            console.log(summary);
            console.log("\n=======================\n");
        } else {
            console.log("\nNo summary generated. This could mean:\n");
            console.log("1. No recent tweets found from the specified accounts");
            console.log("2. Twitter authentication failed");
            console.log("3. Rate limiting from Twitter\n");
        }

        process.exit(0);
    } catch (error) {
        console.error("Test failed:", error);
        console.error("Error details:", error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// Use import.meta.url for ESM modules instead of require.main
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
    main();
}