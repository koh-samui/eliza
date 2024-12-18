# Installation Guide

## Setup Steps

1. Clone the plugin repository:

    ```bash
    cd packages
    git clone git@github.com:topwallets/plugin-topwallets.git
    ```

2. Configure environment variables:

    - Create or edit your `.env` file
    - Add your TopWallets API key:
        ```
        TOPWALLETS_API_KEY=your_api_key_here
        ```

3. Install dependencies:

    ```bash
    pnpm install --no-frozen-lockfile
    ```

4. Build the project:

    ```bash
    pnpm build
    ```

5. Set up the agent:

    ```bash
    touch characters/elyrai.character.json
    ```

    Now copy the character configuration from:
    https://github.com/koh-samui/character/blob/main/elyrai.character.json
    into your newly created `characters/elyrai.character.json` file.

6. Start the agent:
    ```bash
    pnpm start:debug --character="characters/elyrai.character.json"
    ```
