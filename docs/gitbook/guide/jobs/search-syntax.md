# Query Search Syntax

## Overview

The `search` method accepts a `Lucene` style query string that is parsed and converted into a filter to be executed on the server.
Lucene heavily inspires the query syntax. It supports various operators and field types, allowing for flexible searches.

It allows for complex, text-based searches on job data and metadata. Consider the following example:

```typescript
const query =
  'name:encoding AND runtime:[5000 TO *] AND data.filename:(/*.mpg/ OR /*.wav/) AND NOT returnvalue:success';
const { jobs } = await queue.search('completed', query);
```

This search will fetch audio and video encoding jobs that took more than 5 seconds to process and don't have a successful return value.

## Examples

Here are some simple examples:

| Query                                        | Description                                      |
| -------------------------------------------- | ------------------------------------------------ |
| `data.user.id:123`                           | Jobs where the user ID in the job data is `123`. |
| `priority:[2 TO *]`                          | Jobs with priority `2` or above.                 |
| `attemptsMade:0`                             | Jobs that have not been attempted yet.           |
| `timestamp:[1622505600000 TO 1625097600000]` | Jobs created between two timestamps.             |
| `finishedOn:[1622505600000 TO *]`            | Jobs finished after a specific timestamp.        |
| `name:"emailJob"`                            | Jobs with the name `emailJob`.                   |
| `id:42`                                      | Job with ID `42`.                                |
| `stacktrace:/*authorization*/i`              | Jobs which failed with an authorization error.   |
| `returnvalue:"Success"`                      | Jobs that returned `Success`.                    |
| `logs:*peripheral*`                          | Jobs with logs containing the text `peripheral`. |
| `opts.backoff.type:"exponential"`            | Jobs with exponential backoff strategy.          |

## Syntax Guide

The query syntax supports various features to create complex search queries. Below is a detailed guide on the supported syntax:

### 1. Field-based Queries

You can query specific fields of a job using the `field:value` syntax. Matching is exact and case-sensitive.
The job object has several top-level properties that can be queried, including `id`, `name`, `data`, `opts`, `priority`, `delay`, `timestamp`, etc. You can also query
nested properties of the `data` and `opts` objects using dot notation.

**Examples:**

- Find jobs with the name "my-job-name":

```
name:my-job-name
```

- Find jobs with a specific priority:

```
priority:5
```

- Find jobs with a nested data property:

```
data.user.email:test@example.com
```

We also support special `virtual` fields that are not part of the job object but are commonly used:

- `runtime`: The time taken by the worker to process the job. Essentially `finishedOn` - `processedOn`.
- `waitTime`: The time the job spent waiting to be processed. Essentially `processedOn` - `timestamp`.
- `queueTime`: The total time the job spent in the queue from creation to execution. Essentially `finishedOn` - `timestamp`.
- `fullText`: A full-text search across multiple job fields (see Full-Text Search section).
- 'logs': Search within job logs.

### 2. Data Types

The parser automatically handles different data types:

- **Strings**: `name:my-job`
- **Numbers**: `priority:3`
- **Booleans**: `opts.lifo:true`
- **Null**: `data.user.phone:null`

### 3. Phrases

To search for values containing spaces, enclose them in single or double quotes.

```
data.title:"A Job with a long title"
```

### 4. Logical Operators

You can combine multiple conditions using logical operators `AND`, `OR`, `XOR`, and `NOT`. `AND` has higher precedence
than `OR` and `XOR`.

- **AND**: Both conditions must be true.

```
attemptsMade:[2 TO *] AND priority:1
```

You can also use an implicit `AND` by placing two terms next to each other:

```
attemptsMade:[2 TO *] priority:1
```

- **OR**: Either condition can be true.

```
name:job1 OR name:job2
```

- **XOR**: One condition must be true, but not both.

```
"home-user" AND (broadband ^ fiber)
```

- **NOT**: Excludes jobs that match the condition.

```
NOT returnvalue:failed
```

### 5. Grouping

Use parentheses `()` to group expressions and control the order of operations.

**Examples:**

- Grouping `OR` conditions:

```
(name:"process-image" OR name:"process-video") AND priority:1
```

- You can also group values for a single field:

```
name:("process-image" OR "process-video")
```

### 6. Range Queries

Search for values within a specific range.

- **Inclusive range `[]`**:

```
timestamp:[1672531200000 TO 1675209599000]
```

finds jobs with a timestamp between the two values, inclusive.

- **Exclusive range `{}`**:

```
priority:{1 TO 5}
```

finds jobs with a priority from 2 to 4.

- **Open-ended ranges `*`**:

```
runtime:[2000 TO *]
```

finds jobs with which ran for more than 2 seconds.

```
attemptsMade:[* TO 3]
```

finds jobs with three or fewer attempts.

### 7. Wildcard Searches

Perform partial matches using wildcards.

- `*`: Matches zero or more characters.

```
name:user-*
```

(Finds `user-1`, `user-10`, `user-profile`, etc.)

- `?`: Matches a single character.

```
name:user-?
```

(Finds `user-1`, `user-A`, but not `user-10`)

**Examples:**

- `name:start*` (prefix search)
- `name:*end` (suffix search)
- `name:*middle*` (contains search)
- `name:f?ll` (matches "fill", "fall", etc.)

### 8. Regular Expression Searches

For more advanced pattern matching, you can use regular expressions by enclosing the pattern in slashes (`/`). An optional `i` flag can be added for case-insensitive matching.

```
data.username:/^user-[0-9]+$/
```

```
data.username:/john/i
```

### 9. Full-Text Search

If you provide a query string without any field specifiers, BullMQ performs a full-text search across the following job attributes:

- `id`
- `name`
- `data` (the stringified JSON)
- `failedReason`
- `returnvalue` (the stringified JSON)
- `stacktrace` (the stringified JSON)
- `logs`

The full-text search matches any job containing the specified terms in any of these fields. It is _not_ anchored, in
contrast with the other fields.

**Examples:**

- Find jobs containing the word "error":

```
error
```

- Find jobs containing both "user" and "profile":

```
user profile
```

(This is equivalent to `user AND profile`)

- Find jobs containing the phrase "user profile":

```
"user profile"
```
