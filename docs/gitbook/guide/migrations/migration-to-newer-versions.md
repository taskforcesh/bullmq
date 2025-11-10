---
description: Tips and hints on how to migrate your current BullMQ version to a newer one.
---

# Migration to newer versions

BullMQ's team regularly releases new versions packed with bug fixes, new features, or occasionally, breaking changes. As a user operating in a production environment, you might find upgrading to these new versions while maintaining service continuity challenging. This guide offers tips and advice to ease your transition.

The strategies needed vary depending on the nature of the upgrade. Regardless, we urge you to read this guide thoroughly, irrespective of the upgrade you're pursuing.

## General advice

When upgrading BullMQ, always consult the _Changelog_. It helps determine the extent of the changes and flags crucial considerations before upgrading.

Avoid making large leaps between versions. If you're currently on version 1.3.7, for instance, a jump to version 4.2.6 may not be advisable. Upgrade incrementally whenever possible. Start with as many bugfix releases as possible, then proceed to new features, and finally, the major releases that encompass breaking changes.

## Bugfix upgrade

Bugfix releases increase only the micro version number according to [SemVer (_Semantic Versioning_)](https://semver.org/) (for instance, an upgrade from 3.14.4 to 3.14.7). Bugfix upgrades require no special strategies; simply update your instances to the latest version without changing your code or deployment. While it's not critical that all instances run on the same version, we recommend it for consistency.

## New feature upgrade

Following the SemVer specification, new features result in an increase in the minor version number (like going from 3.14.7 to 3.20.5). Generally, you can treat feature upgrades like bugfix upgrades — update all your instances to the latest version.

However, if you're also upgrading your code to utilize a new feature, ensure it's backward compatible with the older BullMQ version. Otherwise, an older `Worker` might stop functioning if a new `Queue` adds jobs leveraging a feature the older `Worker` doesn't understand.

The strategy here is to first upgrade all your instances to the version featuring the new functionality. After confirming all instances run the new version, proceed to deploy your code depending on those new features.

## Breaking changes

Occasionally, unavoidable changes incompatible with previous versions are made. We strive to minimize these, classifying them into two types: API-breaking changes and data structure-breaking changes.

### API breaking changes

API breaking changes could involve altered method parameters, removals, or different operational methods. These changes are usually straightforward to apply — you can run your BullMQ-dependent unit tests and address issues based on these changes. If you're using TypeScript, compilation errors will likely surface. Always read the [changelog](../changelog.md) for essential information about these changes.

### Data structure breaking changes

Data structure changes, which alter the queue's underlying structure, are more challenging. They can be either

- **additive** (introducing new data structures that older BullMQ versions don't understand), or
- **destructive** (changing or eradicating older data structures).

For additive changes, you could simply upgrade all instances to the new version — they should apply the change and continue working without issues, akin to a [new feature upgrade](migration-to-newer-versions.md#new-features-upgrade).

Destructive changes are the most demanding, as these fundamental alterations may make older versions unworkable, making rollback impossible if the upgrade fails. The [changelog](../changelog.md) will provide crucial information to guide you through this type of upgrade.

## Some general strategies

For the most demanding upgrades, you might find these strategies useful:

### Pause/Upgrade/Unpause

Since BullMQ supports global pause, one possible strategy, if suitable for your business case, is to pause the queue(s), wait until all current queued jobs have been processed, then perform the upgrade. Once all instances running BullMQ have been upgraded, you can unpause and let new jobs be processed by the new workers. Be aware this strategy is less useful if breaking changes affect `Queue` instances. Always consult the changelog for this type of information.

### Use new queues altogether

This drastic solution involves discontinuing use of older queues and creating new ones. You could rename older queues (e.g., "myQueueV2"), use a new Redis host, or maintain two versions of the service—one running an older BullMQ version with old queues, and a newer one with the latest BullMQ and a different set of queues. When the older version has no more jobs to process, it can be retired, leaving only the upgraded version.
