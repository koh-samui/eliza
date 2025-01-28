[@elizaos/core v0.1.7](../index.md) / GenerationOptions

# Interface: GenerationOptions

Configuration options for generating objects with a model.

## Properties

### runtime

> **runtime**: [`IAgentRuntime`](IAgentRuntime.md)

#### Defined in

[packages/core/src/generation.ts:1518](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1518)

***

### context

> **context**: `string`

#### Defined in

[packages/core/src/generation.ts:1519](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1519)

***

### modelClass

> **modelClass**: [`ModelClass`](../enumerations/ModelClass.md)

#### Defined in

[packages/core/src/generation.ts:1520](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1520)

***

### schema?

> `optional` **schema**: `ZodType`\<`any`, `ZodTypeDef`, `any`\>

#### Defined in

[packages/core/src/generation.ts:1521](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1521)

***

### schemaName?

> `optional` **schemaName**: `string`

#### Defined in

[packages/core/src/generation.ts:1522](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1522)

***

### schemaDescription?

> `optional` **schemaDescription**: `string`

#### Defined in

[packages/core/src/generation.ts:1523](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1523)

***

### stop?

> `optional` **stop**: `string`[]

#### Defined in

[packages/core/src/generation.ts:1524](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1524)

***

### mode?

> `optional` **mode**: `"auto"` \| `"json"` \| `"tool"`

#### Defined in

[packages/core/src/generation.ts:1525](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1525)

***

### experimental\_providerMetadata?

> `optional` **experimental\_providerMetadata**: `Record`\<`string`, `unknown`\>

#### Defined in

[packages/core/src/generation.ts:1526](https://github.com/koh-samui/eliza/blob/main/packages/core/src/generation.ts#L1526)
