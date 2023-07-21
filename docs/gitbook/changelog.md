# CHANGELOG



## v4.6.1 (2023-07-21)

### Documentation

* docs(retry): add stop retrying jobs pattern (#2080) ref #1571 ([`dd40cf1`](https://github.com/taskforcesh/bullmq/commit/dd40cf1eaf13767ddcd5e68c4f33d974b65e6f18))

### Fix

* fix(python): upgrade semver to prevent warnings (#2074) ([`fc7f92b`](https://github.com/taskforcesh/bullmq/commit/fc7f92bc3cd5208e79405d4573a1b64f692c3be2))


## v4.6.0 (2023-07-19)

### Chore

* chore(release): 4.6.0 [skip ci]

# [4.6.0](https://github.com/taskforcesh/bullmq/compare/v4.5.0...v4.6.0) (2023-07-19)

### Features

* **queue:** add promoteJobs to promote all delayed jobs ([6074592](https://github.com/taskforcesh/bullmq/commit/6074592574256ec4b1c340126288e803e56b1a64)) ([`39b2565`](https://github.com/taskforcesh/bullmq/commit/39b2565325a56b1df87f49dfe3a1ba9deb0ea174))

* chore: fix review comments ([`60484d0`](https://github.com/taskforcesh/bullmq/commit/60484d04dc0c1e602b2638e41ecc5de0e4e66b2d))

### Documentation

* docs(api): remove old api files in favor of typedoc (#2078) ([`75a594f`](https://github.com/taskforcesh/bullmq/commit/75a594f36a2e8c62e16f55d917d1b8f906d18a8c))

### Feature

* feat(queue): add promoteJobs to promote all delayed jobs ([`6074592`](https://github.com/taskforcesh/bullmq/commit/6074592574256ec4b1c340126288e803e56b1a64))


## v4.5.0 (2023-07-18)

### Chore

* chore(release): 4.5.0 [skip ci]

# [4.5.0](https://github.com/taskforcesh/bullmq/compare/v4.4.0...v4.5.0) (2023-07-18)

### Bug Fixes

* **python:** respect concurrency in worker ([#2062](https://github.com/taskforcesh/bullmq/issues/2062)) fixes [#2063](https://github.com/taskforcesh/bullmq/issues/2063) ([1b95185](https://github.com/taskforcesh/bullmq/commit/1b95185e8f4a4349037b59e61455bdec79792644))

### Features

* **job:** add option for removing children in remove method (python) ([#2064](https://github.com/taskforcesh/bullmq/issues/2064)) ([841dc87](https://github.com/taskforcesh/bullmq/commit/841dc87a689897df81438ad1f43e45a4da77c388)) ([`2b31259`](https://github.com/taskforcesh/bullmq/commit/2b31259878b5c6d46429502e1fadf51b74d8872c))

### Feature

* feat(job): add option for removing children in remove method (python) (#2064) ([`841dc87`](https://github.com/taskforcesh/bullmq/commit/841dc87a689897df81438ad1f43e45a4da77c388))

### Fix

* fix(python): respect concurrency in worker (#2062) fixes #2063 ([`1b95185`](https://github.com/taskforcesh/bullmq/commit/1b95185e8f4a4349037b59e61455bdec79792644))

### Unknown

* GITBOOK-176: change request with no subject merged in GitBook ([`4752a4d`](https://github.com/taskforcesh/bullmq/commit/4752a4dda4a2f48526bac7eb9cb322eccd6ea222))

* GITBOOK-175: change request with no subject merged in GitBook ([`8abc1bb`](https://github.com/taskforcesh/bullmq/commit/8abc1bb293c2fd5adbcf88c3aa5c3da7ec1a64fe))

* GITBOOK-174: change request with no subject merged in GitBook ([`34b950a`](https://github.com/taskforcesh/bullmq/commit/34b950a9e0be5a0c541eb8a3887704b4136543d4))

* GITBOOK-173: change request with no subject merged in GitBook ([`2e30d34`](https://github.com/taskforcesh/bullmq/commit/2e30d34edfbc82925215b7e955b4aed6e68d1d8b))


## v4.4.0 (2023-07-17)

### Chore

* chore(release): 4.4.0 [skip ci]

# [4.4.0](https://github.com/taskforcesh/bullmq/compare/v4.3.0...v4.4.0) (2023-07-17)

### Features

* **job:** add removeDependencyOnFailure option ([#1953](https://github.com/taskforcesh/bullmq/issues/1953)) ([ffd49e2](https://github.com/taskforcesh/bullmq/commit/ffd49e289c57252487200d47b92193228ae7451f))
* **python:** add remove method in queue ([#2066](https://github.com/taskforcesh/bullmq/issues/2066)) ([808ee72](https://github.com/taskforcesh/bullmq/commit/808ee7231c75d4d826881f25e346f01b2fd2dc23)) ([`38ed54a`](https://github.com/taskforcesh/bullmq/commit/38ed54a879ecff97fab9757a5ebf6583d6d161fb))

* chore(deps): update coverallsapp/github-action digest to 95b1a23 (#2065)

Co-authored-by: renovate[bot] &lt;29139614+renovate[bot]@users.noreply.github.com&gt; ([`a1577fa`](https://github.com/taskforcesh/bullmq/commit/a1577fa28870939101b1a7e31e04ae53005b9a46))

* chore(deps): update github/codeql-action digest to 489225d ([`d7d0981`](https://github.com/taskforcesh/bullmq/commit/d7d0981e441321c4156704c665a7015ba39d36bf))

* chore(deps): update actions/setup-node digest to e33196f ([`bdaccd3`](https://github.com/taskforcesh/bullmq/commit/bdaccd3aef8310a763169e3670cbbbd5288283e8))

* chore(deps): update dependency dev/setuptools to v68 (#2038)

Co-authored-by: renovate[bot] &lt;29139614+renovate[bot]@users.noreply.github.com&gt; ([`0bdabcd`](https://github.com/taskforcesh/bullmq/commit/0bdabcd4ccf4fb16cc57c7fa67c8ccfe41031bf4))

### Feature

* feat(job): add removeDependencyOnFailure option (#1953) ([`ffd49e2`](https://github.com/taskforcesh/bullmq/commit/ffd49e289c57252487200d47b92193228ae7451f))

* feat(python): add remove method in queue (#2066) ([`808ee72`](https://github.com/taskforcesh/bullmq/commit/808ee7231c75d4d826881f25e346f01b2fd2dc23))


## v4.3.0 (2023-07-14)

### Chore

* chore(release): 4.3.0 [skip ci]

# [4.3.0](https://github.com/taskforcesh/bullmq/compare/v4.2.1...v4.3.0) (2023-07-14)

### Features

* **worker:** add id as part of token ([#2061](https://github.com/taskforcesh/bullmq/issues/2061)) ([e255356](https://github.com/taskforcesh/bullmq/commit/e2553562271e1e4143a8fef616349bb30de4899d)) ([`3b6f33e`](https://github.com/taskforcesh/bullmq/commit/3b6f33eb85f68cff97eb61253884cf540cfb4908))

* chore(deps): update dependency dev/setuptools to v63.4.3 (#2034)

Co-authored-by: renovate[bot] &lt;29139614+renovate[bot]@users.noreply.github.com&gt; ([`f0b823a`](https://github.com/taskforcesh/bullmq/commit/f0b823a2bb078ea9b1fe953f6f068cbfe3eab757))

### Documentation

* docs(stalled): add pattern reference for manual fetching jobs ([`a82401c`](https://github.com/taskforcesh/bullmq/commit/a82401c00cc7378cdf8206b5c74afeaaead39c2c))

* docs(bullmq-pro): update changelog to v6.0.5 ([`37c203c`](https://github.com/taskforcesh/bullmq/commit/37c203c303e00a2aa4d8933bc5e68239547b1aca))

### Feature

* feat(worker): add id as part of token (#2061) ([`e255356`](https://github.com/taskforcesh/bullmq/commit/e2553562271e1e4143a8fef616349bb30de4899d))


## v4.2.1 (2023-07-10)

### Chore

* chore(release): 4.2.1 [skip ci]

## [4.2.1](https://github.com/taskforcesh/bullmq/compare/v4.2.0...v4.2.1) (2023-07-10)

### Bug Fixes

* **flow:** emit delayed event when parent is moved to delayed ([#2055](https://github.com/taskforcesh/bullmq/issues/2055)) ([f419ff1](https://github.com/taskforcesh/bullmq/commit/f419ff1ec5cb34986fe4b79402c727a6487e949c))
* **python:** add requires-python config ([#2056](https://github.com/taskforcesh/bullmq/issues/2056)) fixes [#1979](https://github.com/taskforcesh/bullmq/issues/1979) ([a557970](https://github.com/taskforcesh/bullmq/commit/a557970c755d370ed23850e2f32af35774002bc9))
* **python:** fix isPaused method when custom prefix is present ([#2047](https://github.com/taskforcesh/bullmq/issues/2047)) ([7ec1c5b](https://github.com/taskforcesh/bullmq/commit/7ec1c5b2ccbd575ecd50d339f5377e204ca7aa16))

### Features

* **python:** add moveToWaitingChildren job method ([#2049](https://github.com/taskforcesh/bullmq/issues/2049)) ([6d0e224](https://github.com/taskforcesh/bullmq/commit/6d0e224cd985069055786f447b0ba7c394a76b8a)) ([`fc69da9`](https://github.com/taskforcesh/bullmq/commit/fc69da91d109d713ff16efca0a968466b7868f6c))

* chore(deps): update dependency pipenv to v2023.7.4 (#2042)

Co-authored-by: renovate[bot] &lt;29139614+renovate[bot]@users.noreply.github.com&gt; ([`7508633`](https://github.com/taskforcesh/bullmq/commit/750863373adb9d8a528713a168d03b2dc3173eb1))

* chore(deps): update dependency dev/types-redis to v4.6.0.2 (#2046) ([`b47d622`](https://github.com/taskforcesh/bullmq/commit/b47d622fee8fa4363b23cff7969ac275d5b4b9ba))

* chore(deps): upgrade typedoc to 0.24.0 ([`2ac674d`](https://github.com/taskforcesh/bullmq/commit/2ac674daf78e6879d29f31a601242880bf8f975f))

### Ci

* ci(api): avoid pushing changes to docs-api ([`ce382aa`](https://github.com/taskforcesh/bullmq/commit/ce382aa98994b7831439a3d0f05098d9f39cc4a1))

* ci(api): try to check out all branches ([`9981ce5`](https://github.com/taskforcesh/bullmq/commit/9981ce52a43b732a0097abda1fc9f94f402307f3))

* ci(api): restore origin/master ref ([`08a8a7f`](https://github.com/taskforcesh/bullmq/commit/08a8a7fdd4559668a3c02e34ae0c1ddf2b284c94))

* ci(api): add allow-unrelated-histories ([`4af6072`](https://github.com/taskforcesh/bullmq/commit/4af6072c506dd79b0ba525d86660271aff6a8fe1))

* ci(api): use origin/master ([`c04de32`](https://github.com/taskforcesh/bullmq/commit/c04de320efa53638cc10ebdf7939cca966ff627d))

* ci(api): use checkout ref to change branch ([`967d366`](https://github.com/taskforcesh/bullmq/commit/967d36658ff7a87dcb59f5122a11cdae97d779ef))

* ci(api): add docs-api branch logic (#2045) ([`6303148`](https://github.com/taskforcesh/bullmq/commit/63031484387a8cd8595da7ff0d2721c57b54d7e4))

### Documentation

* docs(gitbook): update v4 references ([`b0adbf8`](https://github.com/taskforcesh/bullmq/commit/b0adbf857ddf4c39fdd8de53fa60d0f0169a7f7a))

### Feature

* feat(python): add moveToWaitingChildren job method (#2049) ([`6d0e224`](https://github.com/taskforcesh/bullmq/commit/6d0e224cd985069055786f447b0ba7c394a76b8a))

### Fix

* fix(flow): emit delayed event when parent is moved to delayed (#2055) ([`f419ff1`](https://github.com/taskforcesh/bullmq/commit/f419ff1ec5cb34986fe4b79402c727a6487e949c))

* fix(python): add requires-python config (#2056) fixes #1979 ([`a557970`](https://github.com/taskforcesh/bullmq/commit/a557970c755d370ed23850e2f32af35774002bc9))

* fix(python): fix isPaused method when custom prefix is present (#2047) ([`7ec1c5b`](https://github.com/taskforcesh/bullmq/commit/7ec1c5b2ccbd575ecd50d339f5377e204ca7aa16))

### Unknown

* doc(python): add python tabs in getters and step jobs pattern ([`f1ca525`](https://github.com/taskforcesh/bullmq/commit/f1ca52541eecbd610b0161b21fe696decd38ee7b))


## v4.2.0 (2023-07-03)

### Chore

* chore(release): 4.2.0 [skip ci]

# [4.2.0](https://github.com/taskforcesh/bullmq/compare/v4.1.0...v4.2.0) (2023-07-03)

### Bug Fixes

* **python:** add recommended pyproject.toml configuration ([#2029](https://github.com/taskforcesh/bullmq/issues/2029)) ([d03ffc9](https://github.com/taskforcesh/bullmq/commit/d03ffc9c98425a96d6e9dd47a6625382556a4cbf))
* **python:** nuild egg-info at the root location ([3c2d06e](https://github.com/taskforcesh/bullmq/commit/3c2d06e7e6e0944135fe6bd8045d08dd43fe7d9c))

### Features

* **common:** add option to change repeatable jobs redis key hash algorithm ([#2023](https://github.com/taskforcesh/bullmq/issues/2023)) ([ca17364](https://github.com/taskforcesh/bullmq/commit/ca17364cc2a52f6577fb66f09ec3168bbf9f1e07))
* **python:** add get job methods by state ([#2012](https://github.com/taskforcesh/bullmq/issues/2012)) ([57b2b72](https://github.com/taskforcesh/bullmq/commit/57b2b72f79afb683067d49170df5d2eed46e3712))
* **python:** add getCompleted queue method ([#2033](https://github.com/taskforcesh/bullmq/issues/2033)) ([3e9db5e](https://github.com/taskforcesh/bullmq/commit/3e9db5ef4d868f8b420e368a711c20c2568a5910))
* **python:** add getFailedCount queue method ([#2036](https://github.com/taskforcesh/bullmq/issues/2036)) ([92d7227](https://github.com/taskforcesh/bullmq/commit/92d7227bf5ec63a75b7af3fc7c312d9b4a81d69f))
* **python:** add getJobs method in queue class ([#2011](https://github.com/taskforcesh/bullmq/issues/2011)) ([8d5d6c1](https://github.com/taskforcesh/bullmq/commit/8d5d6c14442b7b967c42cb6ec3907a4d1a5bd575))
* **python:** add getJobState queue method ([#2040](https://github.com/taskforcesh/bullmq/issues/2040)) ([8ec9ed6](https://github.com/taskforcesh/bullmq/commit/8ec9ed67d2803224a3b866c51f67239a5c4b7042)) ([`5e2a343`](https://github.com/taskforcesh/bullmq/commit/5e2a3430b320f0b28147e7695d8defd59e6a6a8e))

* chore(deps): update dependency dev/types-redis to v4.6.0.1 (#2035) ([`6e5d992`](https://github.com/taskforcesh/bullmq/commit/6e5d99213785c4988184fe70bf9dff6daf021880))

* chore(deps): update coverallsapp/github-action digest to 3b7440a (#2039) ([`cbc489b`](https://github.com/taskforcesh/bullmq/commit/cbc489bd59f689ced93c2c6a4162cde487475a28))

* chore: update python changelog ([`4994bd7`](https://github.com/taskforcesh/bullmq/commit/4994bd7626cd5996eaec77a75a008591cc35980b))

* chore(python): delete license key ([`d6e6449`](https://github.com/taskforcesh/bullmq/commit/d6e64493c979147a351f848212db5fa2282d3852))

* chore(deps): update dependency pipenv to v2023.6.26 ([`47e68bd`](https://github.com/taskforcesh/bullmq/commit/47e68bd6470a155ce3822772e37d1385777b89dd))

* chore(deps): update dependency tslib to v2.6.0 ([`0e33d9f`](https://github.com/taskforcesh/bullmq/commit/0e33d9f12a289bdf378a446d4b4f6851fc91ae44))

* chore(deps): update dependency redis to v4.6.0 ([`cb8edd6`](https://github.com/taskforcesh/bullmq/commit/cb8edd644082dc90dac77bc231b22d13055ec147))

### Documentation

* docs(bullmq-pro): update changelog ([`b71e1ca`](https://github.com/taskforcesh/bullmq/commit/b71e1ca6b3bd77557a6c1219802faaeff8768392))

* docs(changelogs): update changelogs (#2028) ([`667de07`](https://github.com/taskforcesh/bullmq/commit/667de075f4762ab72dbaa5567bbacfd5147d4770))

* docs: update README.md ([`dc63efe`](https://github.com/taskforcesh/bullmq/commit/dc63efe6596c61487f0f7a9fbe06466fbd42d835))

* docs: update broken patterns link in the readme (#2025) ([`0e6e836`](https://github.com/taskforcesh/bullmq/commit/0e6e836376dc89d432f384e5ada0c9356d57252a))

### Feature

* feat(common): add option to change repeatable jobs redis key hash algorithm (#2023) ([`ca17364`](https://github.com/taskforcesh/bullmq/commit/ca17364cc2a52f6577fb66f09ec3168bbf9f1e07))

* feat(python): add getJobState queue method (#2040) ([`8ec9ed6`](https://github.com/taskforcesh/bullmq/commit/8ec9ed67d2803224a3b866c51f67239a5c4b7042))

* feat(python): add getFailedCount queue method (#2036) ([`92d7227`](https://github.com/taskforcesh/bullmq/commit/92d7227bf5ec63a75b7af3fc7c312d9b4a81d69f))

* feat(python): add getCompleted queue method (#2033) ([`3e9db5e`](https://github.com/taskforcesh/bullmq/commit/3e9db5ef4d868f8b420e368a711c20c2568a5910))

* feat(python): add get job methods by state (#2012) ([`57b2b72`](https://github.com/taskforcesh/bullmq/commit/57b2b72f79afb683067d49170df5d2eed46e3712))

* feat(python): add getJobs method in queue class (#2011) ([`8d5d6c1`](https://github.com/taskforcesh/bullmq/commit/8d5d6c14442b7b967c42cb6ec3907a4d1a5bd575))

### Fix

* fix(python): nuild egg-info at the root location ([`3c2d06e`](https://github.com/taskforcesh/bullmq/commit/3c2d06e7e6e0944135fe6bd8045d08dd43fe7d9c))

* fix(python): add recommended pyproject.toml configuration (#2029) ([`d03ffc9`](https://github.com/taskforcesh/bullmq/commit/d03ffc9c98425a96d6e9dd47a6625382556a4cbf))

### Unknown

* GITBOOK-172: change request with no subject merged in GitBook ([`2c45558`](https://github.com/taskforcesh/bullmq/commit/2c4555802d72bccc9c34ee268c80476a20ef7b49))


## v4.1.0 (2023-06-23)

### Chore

* chore(release): 4.1.0 [skip ci]

# [4.1.0](https://github.com/taskforcesh/bullmq/compare/v4.0.0...v4.1.0) (2023-06-23)

### Features

* **queue:** add getPrioritized and getPrioritizedCount methods ([#2005](https://github.com/taskforcesh/bullmq/issues/2005)) ([7363abe](https://github.com/taskforcesh/bullmq/commit/7363abebce6e3bcf067fc7c220d845807ebb1489)) ([`65184e3`](https://github.com/taskforcesh/bullmq/commit/65184e3f1388083e63ff956dea4ad62a1addf710))

* chore(deps): update github/codeql-action digest to f6e388e (#2003) ([`ef2aab9`](https://github.com/taskforcesh/bullmq/commit/ef2aab97592dd55431e413f39b3d97b3db0e5ed4))

### Feature

* feat(queue): add getPrioritized and getPrioritizedCount methods (#2005) ([`7363abe`](https://github.com/taskforcesh/bullmq/commit/7363abebce6e3bcf067fc7c220d845807ebb1489))

### Unknown

* GITBOOK-170: delete old architecture images ([`2e7c90d`](https://github.com/taskforcesh/bullmq/commit/2e7c90d2a5d533d23ec6a9f525259211492097f1))

* GITBOOK-169: New state architecture considering prioritized state ([`df50b99`](https://github.com/taskforcesh/bullmq/commit/df50b99ac22ef92d816ed2cd195de986a0140c6d))


## v4.0.0 (2023-06-21)

### Chore

* chore(release): 4.0.0 [skip ci]

# [4.0.0](https://github.com/taskforcesh/bullmq/compare/v3.15.8...v4.0.0) (2023-06-21)

### Bug Fixes

* **python:** pass right params to xtrim method ([#2004](https://github.com/taskforcesh/bullmq/issues/2004)) ([a55fd77](https://github.com/taskforcesh/bullmq/commit/a55fd777655f7d4bb7af9e4fa2f7b4f48f559189))

### Performance Improvements

* **priority:** add prioritized as a new state ([#1984](https://github.com/taskforcesh/bullmq/issues/1984)) (python) ([42a890a](https://github.com/taskforcesh/bullmq/commit/42a890a2bfe45b29348030f886766400f5d41aa3))

### BREAKING CHANGES

* **priority:** priority is separeted in its own zset, no duplication needed

* feat(queue): add removeDeprecatedPriorityKey method

* refactor: change job method name update to updateData

ref [faster priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/) ([`e0ab7e6`](https://github.com/taskforcesh/bullmq/commit/e0ab7e6fd62487884096ed8fc6164a0be0c4d581))

* chore(deps): update dependency platformdirs to v3.6.0 ([`35e77bb`](https://github.com/taskforcesh/bullmq/commit/35e77bb93262191e379c2cf5c5937ff886b15c16))

* chore(deps): update github/codeql-action digest to 6c089f5 ([`132f2f7`](https://github.com/taskforcesh/bullmq/commit/132f2f7d011a2181d5eb05164ccb094f3e595b9d))

* chore(deps): update dependency pipenv to v2023.6.18 (#1997) ([`fc3f746`](https://github.com/taskforcesh/bullmq/commit/fc3f746441d43ebbc86256583f9b446e2ea874e5))

* chore(deps): update dependency virtualenv to v20.23.1 (#1993) ([`86f8aed`](https://github.com/taskforcesh/bullmq/commit/86f8aed9702baf3be6078c6b92e1f358c888adc6))

* chore(deps): update dependency semver to v7.5.2 (#1987) ([`93005e6`](https://github.com/taskforcesh/bullmq/commit/93005e6a6001b78b6c86e8cc4f463e3152621005))

### Documentation

* docs(update): add job data section (#1999) ([`854b1ca`](https://github.com/taskforcesh/bullmq/commit/854b1cabd082c1df4d55e7973f0e0b0cd4aefb79))

### Fix

* fix(python): pass right params to xtrim method (#2004) ([`a55fd77`](https://github.com/taskforcesh/bullmq/commit/a55fd777655f7d4bb7af9e4fa2f7b4f48f559189))

### Performance

* perf(priority): add prioritized as a new state (#1984) (python)

decouple priority to keep one zset

BREAKING CHANGE: priority is separeted in its own zset, no duplication needed

* feat(queue): add removeDeprecatedPriorityKey method

* refactor: change job method name update to updateData

ref [faster priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/) ([`42a890a`](https://github.com/taskforcesh/bullmq/commit/42a890a2bfe45b29348030f886766400f5d41aa3))

### Unknown

* GITBOOK-168: change request with no subject merged in GitBook ([`361e8cf`](https://github.com/taskforcesh/bullmq/commit/361e8cf330c15c9c5c150bcdc59db0a12e713623))

* GITBOOK-167: change request with no subject merged in GitBook ([`5920445`](https://github.com/taskforcesh/bullmq/commit/59204456c98a1f23c1bc4e0626850a8aa496795c))

* GITBOOK-166: change request with no subject merged in GitBook ([`1b1db39`](https://github.com/taskforcesh/bullmq/commit/1b1db390b4482925852b96aabc8a6fae56cfc500))

* GITBOOK-165: change request with no subject merged in GitBook ([`758dd30`](https://github.com/taskforcesh/bullmq/commit/758dd30ab60777ae66b5590faab24922affdcd46))

* GITBOOK-164: change request with no subject merged in GitBook ([`0cf17de`](https://github.com/taskforcesh/bullmq/commit/0cf17de033f6337c261c7ecab7dadb54a2ba17de))


## v3.15.8 (2023-06-16)

### Chore

* chore(release): 3.15.8 [skip ci]

## [3.15.8](https://github.com/taskforcesh/bullmq/compare/v3.15.7...v3.15.8) (2023-06-16)

### Bug Fixes

* **rate-limit:** keep priority fifo order ([#1991](https://github.com/taskforcesh/bullmq/issues/1991)) fixes [#1929](https://github.com/taskforcesh/bullmq/issues/1929) (python) ([56bd7ad](https://github.com/taskforcesh/bullmq/commit/56bd7ad8c4daffcfb1f9f199abfc5d6495eb291e)) ([`5c36ae3`](https://github.com/taskforcesh/bullmq/commit/5c36ae318766741a00a07af587255a5e951bd731))

* chore(deps): update dependency pre-commit to v3.3.3 ([`dadeef3`](https://github.com/taskforcesh/bullmq/commit/dadeef3d31fda8ca826ca6f8b742574d761fd220))

* chore(deps): update dependency pipenv to v2023.6.12 ([`1434f7e`](https://github.com/taskforcesh/bullmq/commit/1434f7eaa515e30f2a819d6af3bcefabf7643790))

### Fix

* fix(rate-limit): keep priority fifo order (#1991) fixes #1929 (python) ([`56bd7ad`](https://github.com/taskforcesh/bullmq/commit/56bd7ad8c4daffcfb1f9f199abfc5d6495eb291e))


## v3.15.7 (2023-06-16)

### Chore

* chore(release): 3.15.7 [skip ci]

## [3.15.7](https://github.com/taskforcesh/bullmq/compare/v3.15.6...v3.15.7) (2023-06-16)

### Bug Fixes

* **python:** add retry strategy in connection ([#1975](https://github.com/taskforcesh/bullmq/issues/1975)) ([7c5ee20](https://github.com/taskforcesh/bullmq/commit/7c5ee20471b989d297c8c5e87a6ea497a2077ae6))
* **worker:** set redis version always in initialization ([#1989](https://github.com/taskforcesh/bullmq/issues/1989)) fixes [#1988](https://github.com/taskforcesh/bullmq/issues/1988) ([a1544a8](https://github.com/taskforcesh/bullmq/commit/a1544a8c0f29522cd33772b14f559969db852d1d)) ([`90c34c3`](https://github.com/taskforcesh/bullmq/commit/90c34c37605134c72d560ed0fc6aa03a63b6cbca))

* chore(deps): update dependency msgpackr to v1.9.5 ([`c1c8eb0`](https://github.com/taskforcesh/bullmq/commit/c1c8eb03f60188e1328507c1565fb2826081c824))

* chore(deps): update dependency filelock to v3.12.2 ([`c6e7b8b`](https://github.com/taskforcesh/bullmq/commit/c6e7b8bbc6dfa57e9c2142bfda56d0f080f8c165))

* chore: fix python CHANGELOG ref ([`67e5df9`](https://github.com/taskforcesh/bullmq/commit/67e5df913f65ed94dc3500480bee785a7d01f57b))

* chore: update CHANGELOG.md ref ([`be20157`](https://github.com/taskforcesh/bullmq/commit/be20157b79b6359cc0b778d6952f716fa64e2feb))

* chore: update python changelog ([`fbedf2c`](https://github.com/taskforcesh/bullmq/commit/fbedf2c45ea0c0030eff26de6fb432c68e7697a9))

### Fix

* fix(worker): set redis version always in initialization (#1989) fixes #1988 ([`a1544a8`](https://github.com/taskforcesh/bullmq/commit/a1544a8c0f29522cd33772b14f559969db852d1d))

* fix(python): add retry strategy in connection (#1975) ([`7c5ee20`](https://github.com/taskforcesh/bullmq/commit/7c5ee20471b989d297c8c5e87a6ea497a2077ae6))

### Unknown

* GITBOOK-163: docs(removing-jobs): add code tabs for python ([`234e3ad`](https://github.com/taskforcesh/bullmq/commit/234e3ad7f9dfc68540fb6c118dc6ff12ac8f6c25))


## v3.15.6 (2023-06-13)

### Chore

* chore(release): 3.15.6 [skip ci]

## [3.15.6](https://github.com/taskforcesh/bullmq/compare/v3.15.5...v3.15.6) (2023-06-13)

### Bug Fixes

* **worker:** use timeout as integer for redis lower than v6.0.0 (python) ([#1981](https://github.com/taskforcesh/bullmq/issues/1981)) ([0df6afa](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb)) ([`7f42665`](https://github.com/taskforcesh/bullmq/commit/7f42665640b0cec1eaf32b4fec15ff1955164f8b))

### Documentation

* docs(python): add missing version sections (#1974) ([`77b4de7`](https://github.com/taskforcesh/bullmq/commit/77b4de7c3b41ae63e311a2c373e0d2fc787f2f53))

### Fix

* fix(worker): use timeout as integer for redis lower than v6.0.0 (python) (#1981) ([`0df6afa`](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb))


## v3.15.5 (2023-06-11)

### Chore

* chore(release): 3.15.5 [skip ci]

## [3.15.5](https://github.com/taskforcesh/bullmq/compare/v3.15.4...v3.15.5) (2023-06-11)

### Bug Fixes

* **python:** include lua scripts when releasing ([bb4f3b2](https://github.com/taskforcesh/bullmq/commit/bb4f3b2be8e3d5a54a87f0f5d6ba8dfa09900e53))
* **retry-job:** consider priority when moving job to wait (python) ([#1969](https://github.com/taskforcesh/bullmq/issues/1969)) ([e753855](https://github.com/taskforcesh/bullmq/commit/e753855eef248da73a5e9f6b18f4b79319dc2f86))

### Features

* **python:** add remove job method ([#1965](https://github.com/taskforcesh/bullmq/issues/1965)) ([6a172e9](https://github.com/taskforcesh/bullmq/commit/6a172e97e65684f65ee570c2ae9bcc108720d5df)) ([`69b94aa`](https://github.com/taskforcesh/bullmq/commit/69b94aae13033a385bccd93f82601a0c7c4f45a0))

* chore(deps): update actions/checkout digest to c85c95e (#1968) ([`85d8767`](https://github.com/taskforcesh/bullmq/commit/85d8767e96d17dc013c2553dd41e88e2c32c31f0))

### Ci

* ci(python): add build execution before python release ([`fdaaff0`](https://github.com/taskforcesh/bullmq/commit/fdaaff0d51aaf8d1b585c88071aabf9749cceeb2))

* ci(python): check command files ([`1531db4`](https://github.com/taskforcesh/bullmq/commit/1531db4ed74b218b08f7379e0e97e5a3fe709e63))

### Feature

* feat(python): add remove job method (#1965) ([`6a172e9`](https://github.com/taskforcesh/bullmq/commit/6a172e97e65684f65ee570c2ae9bcc108720d5df))

### Fix

* fix(retry-job): consider priority when moving job to wait (python) (#1969) ([`e753855`](https://github.com/taskforcesh/bullmq/commit/e753855eef248da73a5e9f6b18f4b79319dc2f86))

* fix(python): include lua scripts when releasing ([`bb4f3b2`](https://github.com/taskforcesh/bullmq/commit/bb4f3b2be8e3d5a54a87f0f5d6ba8dfa09900e53))


## v3.15.4 (2023-06-08)

### Chore

* chore(release): 3.15.4 [skip ci]

## [3.15.4](https://github.com/taskforcesh/bullmq/compare/v3.15.3...v3.15.4) (2023-06-08)

### Bug Fixes

* **job:** import right reference of QueueEvents ([#1964](https://github.com/taskforcesh/bullmq/issues/1964)) ([689c845](https://github.com/taskforcesh/bullmq/commit/689c84567f3a9fea51f349ca93b3008d5c187f62)) ([`2ea7483`](https://github.com/taskforcesh/bullmq/commit/2ea74830cf0363ea39b077258d70f996f255a519))

### Ci

* ci(python): install packaging module ([`ef0f7ed`](https://github.com/taskforcesh/bullmq/commit/ef0f7ed1d4e9e1b4f8bf7aecd79bc677c956ff67))

* ci(python): set user git information ([`38d23ae`](https://github.com/taskforcesh/bullmq/commit/38d23aed22ca0eb16171a013c37b51cdb403e8be))

* ci(python): downgrade python-semantic-release to avoid version issue ([`8a7cd62`](https://github.com/taskforcesh/bullmq/commit/8a7cd621d57aaceb1e432445fb86598dfb12cb55))

* ci(python): use version_source as commit ([`8002570`](https://github.com/taskforcesh/bullmq/commit/8002570555b1dfdfed3d3d331de23173d9cc67c8))

* ci(python): use version_source ([`973a9d3`](https://github.com/taskforcesh/bullmq/commit/973a9d357fc954ea6c44b2e14e18aef766208129))

### Fix

* fix(job): import right reference of QueueEvents (#1964) ([`689c845`](https://github.com/taskforcesh/bullmq/commit/689c84567f3a9fea51f349ca93b3008d5c187f62))


## v3.15.3 (2023-06-08)

### Chore

* chore(release): 3.15.3 [skip ci]

## [3.15.3](https://github.com/taskforcesh/bullmq/compare/v3.15.2...v3.15.3) (2023-06-08)

### Bug Fixes

* **job:** use QueueEvents type for waitUntilFinished ([#1958](https://github.com/taskforcesh/bullmq/issues/1958)) ([881848c](https://github.com/taskforcesh/bullmq/commit/881848c1ee3835dac24daf6807b1f35da967f68b)) ([`0db3d46`](https://github.com/taskforcesh/bullmq/commit/0db3d46690acdf4b8b703427ba3fbed0893724e1))

* chore(deps): update dependency tslib to v2.5.3 ([`f1badc1`](https://github.com/taskforcesh/bullmq/commit/f1badc1d3ffbc0e5f70df4881a9e4586505083a7))

* chore(deps): update coverallsapp/github-action digest to c7885c0 ([`75e2803`](https://github.com/taskforcesh/bullmq/commit/75e280316a123c1620a408a0c91b3923f4408c83))

* chore(deps): update dependency pre-commit to v3 ([`49e078c`](https://github.com/taskforcesh/bullmq/commit/49e078c7e15d6548c9c71669cf15fd38f67da2cd))

* chore(deps): upgrade sinon ([`c884c35`](https://github.com/taskforcesh/bullmq/commit/c884c3550d48df11ddb1e50f0500aef37cb89a66))

* chore(python): bump to version 0.4.3 ([`8ad2e12`](https://github.com/taskforcesh/bullmq/commit/8ad2e124ea75a110981779b1fddb082f6210ac54))

### Ci

* ci(python): move into python subfolder when releasing ([`d15581d`](https://github.com/taskforcesh/bullmq/commit/d15581d21bc9e5ed826c92b26cbe2f2b82c1c416))

* ci(python): use contains method instead of startsWith ([`646707b`](https://github.com/taskforcesh/bullmq/commit/646707bf5559ce5ee129527b8c5905922af4002d))

* ci(python): add python-semantic-release (#1957) ([`83cd060`](https://github.com/taskforcesh/bullmq/commit/83cd06049ead23a4a6ab4ac6dbb53371ca678ab5))

### Fix

* fix(job): use QueueEvents type for waitUntilFinished (#1958) ([`881848c`](https://github.com/taskforcesh/bullmq/commit/881848c1ee3835dac24daf6807b1f35da967f68b))


## v3.15.2 (2023-06-06)

### Chore

* chore(release): 3.15.2 [skip ci]

## [3.15.2](https://github.com/taskforcesh/bullmq/compare/v3.15.1...v3.15.2) (2023-06-06)

### Bug Fixes

* **worker:** better worker client naming ([c5f63af](https://github.com/taskforcesh/bullmq/commit/c5f63affe72f7b6616f4c5f3aafde858dcc0b200)) ([`492f686`](https://github.com/taskforcesh/bullmq/commit/492f686e685744511e3f817bf5f1d503e8094392))

### Fix

* fix(worker): better worker client naming ([`c5f63af`](https://github.com/taskforcesh/bullmq/commit/c5f63affe72f7b6616f4c5f3aafde858dcc0b200))


## v3.15.1 (2023-06-05)

### Chore

* chore(release): 3.15.1 [skip ci]

## [3.15.1](https://github.com/taskforcesh/bullmq/compare/v3.15.0...v3.15.1) (2023-06-05)

### Bug Fixes

* **rate-limit:** consider paused queue ([#1931](https://github.com/taskforcesh/bullmq/issues/1931)) ([d97864a](https://github.com/taskforcesh/bullmq/commit/d97864a550992aeb8673557c7d8f186ab4ccb5bf))

### Features

* **python:** add changePriority method ([#1943](https://github.com/taskforcesh/bullmq/issues/1943)) ([945bcd3](https://github.com/taskforcesh/bullmq/commit/945bcd39db0f76ef6e9a513304714c120317c7f3)) ([`b1097c9`](https://github.com/taskforcesh/bullmq/commit/b1097c9d72dbe2cde7e2e5f6019d49e34d69b6b5))

* chore(deps): update actions/setup-python digest to bd6b4b6 (#1916) ([`bcc8030`](https://github.com/taskforcesh/bullmq/commit/bcc8030799907340f2f3db03edb2d83c77a52fb0))

### Feature

* feat(python): add changePriority method (#1943) ([`945bcd3`](https://github.com/taskforcesh/bullmq/commit/945bcd39db0f76ef6e9a513304714c120317c7f3))

### Fix

* fix(rate-limit): consider paused queue (#1931) ([`d97864a`](https://github.com/taskforcesh/bullmq/commit/d97864a550992aeb8673557c7d8f186ab4ccb5bf))

### Refactor

* refactor(move-to-finished): return 4 values to prevent python errors when destructuring (#1936) ([`f391f2a`](https://github.com/taskforcesh/bullmq/commit/f391f2a27d5c2959c2a591d14578b9ae125c35f6))


## v3.15.0 (2023-05-31)

### Chore

* chore(release): 3.15.0 [skip ci]

# [3.15.0](https://github.com/taskforcesh/bullmq/compare/v3.14.2...v3.15.0) (2023-05-31)

### Features

* **job:** add changePriority method ([#1901](https://github.com/taskforcesh/bullmq/issues/1901)) ref [#1899](https://github.com/taskforcesh/bullmq/issues/1899) ([9485ad5](https://github.com/taskforcesh/bullmq/commit/9485ad567e2d8c78d601cc9eb2b7dd37f96d00c9)) ([`1ccf486`](https://github.com/taskforcesh/bullmq/commit/1ccf4864c957b85f244e45673513cea239796ea4))

* chore(deps): lock file maintenance ([`8f4d86a`](https://github.com/taskforcesh/bullmq/commit/8f4d86a547b854ea844c5a13704874af90744c2c))

### Feature

* feat(job): add changePriority method (#1901) ref #1899 ([`9485ad5`](https://github.com/taskforcesh/bullmq/commit/9485ad567e2d8c78d601cc9eb2b7dd37f96d00c9))


## v3.14.2 (2023-05-30)

### Chore

* chore(release): 3.14.2 [skip ci]

## [3.14.2](https://github.com/taskforcesh/bullmq/compare/v3.14.1...v3.14.2) (2023-05-30)

### Bug Fixes

* **python:** fix &#39;install_requires&#39; to include semver ([#1927](https://github.com/taskforcesh/bullmq/issues/1927)) ([ce86ece](https://github.com/taskforcesh/bullmq/commit/ce86eceed40283b5d3276968b65ceae31ce425bb))
* **rate-limit:** take in count priority ([#1919](https://github.com/taskforcesh/bullmq/issues/1919)) fixes [#1915](https://github.com/taskforcesh/bullmq/issues/1915) ([b8157a3](https://github.com/taskforcesh/bullmq/commit/b8157a3424ceb60e662e80a3b0db918241b87ecc)) ([`6f4fb3c`](https://github.com/taskforcesh/bullmq/commit/6f4fb3cac980a06816660bbc7339b81db801f4d7))

* chore(python): bump to v0.4.1 ([`7509642`](https://github.com/taskforcesh/bullmq/commit/75096429d7a46d1f7babccdd4914f707eac32770))

* chore(python): add missing types to package

Include types directory ([`7bc4f0b`](https://github.com/taskforcesh/bullmq/commit/7bc4f0bd02cf85be6e3ec9e363657d0260b826d6))

### Documentation

* docs: add project homepage ([`adc5425`](https://github.com/taskforcesh/bullmq/commit/adc5425380b0e573dbf7a3b7423a631eff3ba351))

### Fix

* fix(rate-limit): take in count priority (#1919) fixes #1915 ([`b8157a3`](https://github.com/taskforcesh/bullmq/commit/b8157a3424ceb60e662e80a3b0db918241b87ecc))

* fix(python): fix &#39;install_requires&#39; to include semver (#1927) ([`ce86ece`](https://github.com/taskforcesh/bullmq/commit/ce86eceed40283b5d3276968b65ceae31ce425bb))


## v3.14.1 (2023-05-27)

### Chore

* chore(release): 3.14.1 [skip ci]

## [3.14.1](https://github.com/taskforcesh/bullmq/compare/v3.14.0...v3.14.1) (2023-05-27)

### Features

* **python:** add getState method ([#1906](https://github.com/taskforcesh/bullmq/issues/1906)) ([f0867a6](https://github.com/taskforcesh/bullmq/commit/f0867a679c75555fa764078481252110c1e7377f))

### Performance Improvements

* **retry-job:** get target queue list once ([#1921](https://github.com/taskforcesh/bullmq/issues/1921)) ([8a7a9dd](https://github.com/taskforcesh/bullmq/commit/8a7a9ddd793161a8591485ed18a191ece37026a8)) ([`5b1c5e9`](https://github.com/taskforcesh/bullmq/commit/5b1c5e9ccf2b01e2367582bd3214f9abdccea602))

* chore(deps): update dependency certifi to v2023 ([`8ab2353`](https://github.com/taskforcesh/bullmq/commit/8ab2353728a34c91f6b13cf697c10912158d2075))

* chore(deps): update dependency pipenv to v2023.5.19 ([`b59c2f8`](https://github.com/taskforcesh/bullmq/commit/b59c2f8bd79f43bcacbac0371710be0cdbc633b2))

### Documentation

* docs(events): add listener api references (#1913) ([`864b5e5`](https://github.com/taskforcesh/bullmq/commit/864b5e56afb1fb1a92f41d06b155529f8f701838))

### Feature

* feat(python): add getState method (#1906) ([`f0867a6`](https://github.com/taskforcesh/bullmq/commit/f0867a679c75555fa764078481252110c1e7377f))

### Performance

* perf(retry-job): get target queue list once (#1921) ([`8a7a9dd`](https://github.com/taskforcesh/bullmq/commit/8a7a9ddd793161a8591485ed18a191ece37026a8))

### Test

* test(job): do not save stacktrace when job key is missing (#1918) ref #1914 ([`b2d79cd`](https://github.com/taskforcesh/bullmq/commit/b2d79cdee63152b85228b5002f60c82127b9e630))

### Unknown

* GITBOOK-162: change request with no subject merged in GitBook ([`84f03c4`](https://github.com/taskforcesh/bullmq/commit/84f03c43107af4cc1ee01da448662aa79c0ffdf8))

* GITBOOK-161: change request with no subject merged in GitBook ([`5671b8c`](https://github.com/taskforcesh/bullmq/commit/5671b8cf4587a9a254ac4e1c53ae27b13c7d10fe))

* GITBOOK-159: change request with no subject merged in GitBook ([`e83e284`](https://github.com/taskforcesh/bullmq/commit/e83e28459ac66851ef72a6cf402cd94459ead684))

* GITBOOK-158: change request with no subject merged in GitBook ([`9399384`](https://github.com/taskforcesh/bullmq/commit/93993844c6d60421a8e39d65875088c2367ca4f9))


## v3.14.0 (2023-05-22)

### Chore

* chore(release): 3.14.0 [skip ci]

# [3.14.0](https://github.com/taskforcesh/bullmq/compare/v3.13.4...v3.14.0) (2023-05-22)

### Features

* **worker:** make extendLocks overridable ([7b1386b](https://github.com/taskforcesh/bullmq/commit/7b1386bb823562d9666a1ad6e206e1deb63e57ec)) ([`5beaf52`](https://github.com/taskforcesh/bullmq/commit/5beaf5285bb06d457dceb7ae636ecefff80ed881))

* chore(deps): update dependency tslib to v2.5.2 (#1905) ([`02594d6`](https://github.com/taskforcesh/bullmq/commit/02594d67e73c0bfe43d0045e8f988beff27d5c0d))

* chore(python): bump to version 0.4.0 ([`5d8f57f`](https://github.com/taskforcesh/bullmq/commit/5d8f57fc1b967fe33f1cb561bb907c720bf4a286))

* chore(deps): update coverallsapp/github-action digest to 059e56d (#1907) ([`b600624`](https://github.com/taskforcesh/bullmq/commit/b60062445a5b1f918e5a62d04576c8cac96719dc))

* chore(bullmq-pro): update changelog (#1902) ([`d164fa8`](https://github.com/taskforcesh/bullmq/commit/d164fa8745514fe46bfb3feb02d24884e4ea4697))

* chore(deps): update dependency redis to v4.5.5 (#1883) ([`5b94b1c`](https://github.com/taskforcesh/bullmq/commit/5b94b1ca3d23e1cfa6d3efb73e042670d0421c39))

* chore(deps): lock file maintenance ([`80d39ac`](https://github.com/taskforcesh/bullmq/commit/80d39ace2cbaf61b325af8eaf3c3fe1b2bb212e6))

* chore(deps): update dependency platformdirs to v3.5.1 ([`4825098`](https://github.com/taskforcesh/bullmq/commit/4825098380066417ca1a9c3c96a750f8e8b6a81a))

### Ci

* ci(python): fix commitmsg env reference ([`822f7a9`](https://github.com/taskforcesh/bullmq/commit/822f7a904e3f91c6b95f9faf40288427d7c20f43))

* ci(python): fix conditional step by startsWith ([`eb3d1d4`](https://github.com/taskforcesh/bullmq/commit/eb3d1d499b64c07f8385dc6db99370588977f9cf))

* ci(python): echo commit message ([`7510c22`](https://github.com/taskforcesh/bullmq/commit/7510c226a5094ae3042f3d15225708c1e1d83709))

* ci(python): retry lint with flake8 python ([`10191ef`](https://github.com/taskforcesh/bullmq/commit/10191ef0b2e6e578dbf3c5ab243bf1958c6a2383))

* ci(python): retry install dependencies python ([`1261fc4`](https://github.com/taskforcesh/bullmq/commit/1261fc487a88ee9df924f275c4eae45e7e8c62ee))

* ci(python): retry setup python ([`980796c`](https://github.com/taskforcesh/bullmq/commit/980796c9540e4603907e49b095bbd3b328aec29f))

* ci(python): remove setup python ([`23c6207`](https://github.com/taskforcesh/bullmq/commit/23c6207db9be71aef1827737a461b43c39eb05e8))

* ci(python): delete install dependencies python step ([`8d03ba1`](https://github.com/taskforcesh/bullmq/commit/8d03ba1daf5008fff8d6689ec5e335b25b9fbe2b))

* ci(python): delete flake8 step ([`e94bd83`](https://github.com/taskforcesh/bullmq/commit/e94bd835dc798ea60fcf4ce7942542f12cf42ed8))

* ci(python): delete commitmsg variable ([`2441eaf`](https://github.com/taskforcesh/bullmq/commit/2441eaf8ea52d12b1cf645051be5592e48a8e855))

* ci(python): delete Release Python step ([`3bf5e8d`](https://github.com/taskforcesh/bullmq/commit/3bf5e8dec40c40fd46a3f5fe551e7992804a51df))

* ci(python): try to save commit message for python action ([`d3673a1`](https://github.com/taskforcesh/bullmq/commit/d3673a1b79dbb1629d0b19f3fd9abcfdb32b32e0))

### Feature

* feat(worker): make extendLocks overridable ([`7b1386b`](https://github.com/taskforcesh/bullmq/commit/7b1386bb823562d9666a1ad6e206e1deb63e57ec))

### Test

* test(worker): fix flaky test ([`e08b91b`](https://github.com/taskforcesh/bullmq/commit/e08b91b6906e2a3924955f180d431fc18c0c9c18))

### Unknown

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`7970c60`](https://github.com/taskforcesh/bullmq/commit/7970c6066e3524363d649aa9d46faae57df6734c))


## v3.13.4 (2023-05-11)

### Chore

* chore(release): 3.13.4 [skip ci]

## [3.13.4](https://github.com/taskforcesh/bullmq/compare/v3.13.3...v3.13.4) (2023-05-11)

### Performance Improvements

* **rate-limit:** call pttl in script moveJobFromActiveToWait ([#1889](https://github.com/taskforcesh/bullmq/issues/1889)) ([e0d2992](https://github.com/taskforcesh/bullmq/commit/e0d2992eb757d437dede52054c049470d986ad44)) ([`d7e640c`](https://github.com/taskforcesh/bullmq/commit/d7e640c6368a714f611920be849648348052de05))

### Performance

* perf(rate-limit): call pttl in script moveJobFromActiveToWait (#1889) ([`e0d2992`](https://github.com/taskforcesh/bullmq/commit/e0d2992eb757d437dede52054c049470d986ad44))


## v3.13.3 (2023-05-10)

### Chore

* chore(release): 3.13.3 [skip ci]

## [3.13.3](https://github.com/taskforcesh/bullmq/compare/v3.13.2...v3.13.3) (2023-05-10)

### Bug Fixes

* **child:** use named import for EventEmitter ([#1887](https://github.com/taskforcesh/bullmq/issues/1887)) ([1db396d](https://github.com/taskforcesh/bullmq/commit/1db396d1f54154dc94c796ae8b570336fc341f02)) ([`64658c0`](https://github.com/taskforcesh/bullmq/commit/64658c024508fe91e85a291116ed899bbea0d564))

### Documentation

* docs(bullmq-pro): update changelog (#1888) ([`0acfb79`](https://github.com/taskforcesh/bullmq/commit/0acfb79f779c6dcffca946f843290ae7bc4066e7))

### Fix

* fix(child): use named import for EventEmitter (#1887) ([`1db396d`](https://github.com/taskforcesh/bullmq/commit/1db396d1f54154dc94c796ae8b570336fc341f02))


## v3.13.2 (2023-05-09)

### Chore

* chore(release): 3.13.2 [skip ci]

## [3.13.2](https://github.com/taskforcesh/bullmq/compare/v3.13.1...v3.13.2) (2023-05-09)

### Bug Fixes

* **rate-limit:** consider paused queue when dynamic rate limit ([#1884](https://github.com/taskforcesh/bullmq/issues/1884)) ([a23f37e](https://github.com/taskforcesh/bullmq/commit/a23f37e4079d34c8589efc85e4d726a62244f0d2)) ([`ce8059d`](https://github.com/taskforcesh/bullmq/commit/ce8059d5c6620acc9f8a090e447c610f80913af4))

### Fix

* fix(rate-limit): consider paused queue when dynamic rate limit (#1884) ([`a23f37e`](https://github.com/taskforcesh/bullmq/commit/a23f37e4079d34c8589efc85e4d726a62244f0d2))


## v3.13.1 (2023-05-07)

### Chore

* chore(release): 3.13.1 [skip ci]

## [3.13.1](https://github.com/taskforcesh/bullmq/compare/v3.13.0...v3.13.1) (2023-05-07)

### Bug Fixes

* **retry:** consider when queue is paused ([#1880](https://github.com/taskforcesh/bullmq/issues/1880)) ([01b621f](https://github.com/taskforcesh/bullmq/commit/01b621fea0cbdae602482ff61361c05646823223)) ([`a880069`](https://github.com/taskforcesh/bullmq/commit/a880069ca02c1b9eb64fb42a0d269b3e98aa91c3))

### Fix

* fix(retry): consider when queue is paused (#1880) ([`01b621f`](https://github.com/taskforcesh/bullmq/commit/01b621fea0cbdae602482ff61361c05646823223))


## v3.13.0 (2023-05-06)

### Chore

* chore(release): 3.13.0 [skip ci]

# [3.13.0](https://github.com/taskforcesh/bullmq/compare/v3.12.1...v3.13.0) (2023-05-06)

### Features

* **worker:** add worker threads support ([0820985](https://github.com/taskforcesh/bullmq/commit/0820985e073582fdf841affad38ecc7ab64691ec)) ([`dd1803f`](https://github.com/taskforcesh/bullmq/commit/dd1803f866ff249f2c19691dc1c020a69125a88f))

* chore: add missing renaming of master to main ([`73ce10d`](https://github.com/taskforcesh/bullmq/commit/73ce10d31b1498e18dc352f4593444507036a6b4))

### Feature

* feat(worker): add worker threads support ([`0820985`](https://github.com/taskforcesh/bullmq/commit/0820985e073582fdf841affad38ecc7ab64691ec))

### Test

* test(child-pool): add another test ([`6ea5bbb`](https://github.com/taskforcesh/bullmq/commit/6ea5bbbd87129d447544d5223696f7cf1f7372d6))

* test: increase coverage for async fifo queue ([`7b8949c`](https://github.com/taskforcesh/bullmq/commit/7b8949cb4d2224f90da3c0d710393736960cc55c))


## v3.12.1 (2023-05-05)

### Chore

* chore(release): 3.12.1 [skip ci]

## [3.12.1](https://github.com/taskforcesh/bullmq/compare/v3.12.0...v3.12.1) (2023-05-05)

### Bug Fixes

* **python:** stop processes when force stop ([#1837](https://github.com/taskforcesh/bullmq/issues/1837)) ([514699c](https://github.com/taskforcesh/bullmq/commit/514699cd8be96db2320bf0f85d4b6593809a09f1))
* **worker:** close open handles after closing ([#1861](https://github.com/taskforcesh/bullmq/issues/1861)) fixes [#1312](https://github.com/taskforcesh/bullmq/issues/1312) ([39286e8](https://github.com/taskforcesh/bullmq/commit/39286e87e8ffabf641f229cf2da3db4c280f4637))

### Features

* **python:** accept redis options as string ([01f549e](https://github.com/taskforcesh/bullmq/commit/01f549e62a33619a7816758910a2d2b5ac75b589))
* **python:** add moveToDelayed job method ([#1849](https://github.com/taskforcesh/bullmq/issues/1849)) ([5bebf8d](https://github.com/taskforcesh/bullmq/commit/5bebf8d6560de78448b0413baaabd26f7227575c))
* **python:** add retry method into job ([#1877](https://github.com/taskforcesh/bullmq/issues/1877)) ([870da45](https://github.com/taskforcesh/bullmq/commit/870da459f419076f03885a12a4ce5a2930c500f3))
* **python:** add updateData method ([#1871](https://github.com/taskforcesh/bullmq/issues/1871)) ([800b8c4](https://github.com/taskforcesh/bullmq/commit/800b8c46e709a8cbc4674d84bd59d5c62251d271))
* **python:** add updateProgress method in job class([#1830](https://github.com/taskforcesh/bullmq/issues/1830)) ([e1e1aa2](https://github.com/taskforcesh/bullmq/commit/e1e1aa2e7a41e5418a5a50af4cea347a38bbc7d1))
* **python:** save stacktrace when job fails ([#1859](https://github.com/taskforcesh/bullmq/issues/1859)) ([0b538ce](https://github.com/taskforcesh/bullmq/commit/0b538cedf63c3f006838ee3d016e463ee3492f81))
* **python:** support retryJob logic ([#1869](https://github.com/taskforcesh/bullmq/issues/1869)) ([b044a03](https://github.com/taskforcesh/bullmq/commit/b044a03159bc3a8d8823c71019f64825f318a6c2)) ([`8f02061`](https://github.com/taskforcesh/bullmq/commit/8f020618d364c5706aca63086effe993fd437bbc))

* chore(deps): update coverallsapp/github-action digest to 09b709c ([`7af4c78`](https://github.com/taskforcesh/bullmq/commit/7af4c78af61c93925e768da358fd1dcdbaad1165))

* chore(deps): update dependency virtualenv to v20.23.0 ([`31c475a`](https://github.com/taskforcesh/bullmq/commit/31c475aba94ce3ace5f3da67b759595097a8ca7e))

* chore(deps): update github/codeql-action digest to 29b1f65 (#1876) ([`e81e94a`](https://github.com/taskforcesh/bullmq/commit/e81e94aeef1a07a975235c1c330f297c2bf8c9f5))

* chore(worker): remove out-commented code ([`332672b`](https://github.com/taskforcesh/bullmq/commit/332672b5d589f624db7c7dbd4a130536a011cb83))

* chore(python): update python version ([`3ae441a`](https://github.com/taskforcesh/bullmq/commit/3ae441a904f1e5555754f116cb7f5f0ef38930f6))

* chore(deps): update dependency platformdirs to v3.5.0 ([`a0b8cd3`](https://github.com/taskforcesh/bullmq/commit/a0b8cd3ca96f7ad386d437355bfb630da058d233))

* chore(deps): update github/codeql-action digest to f3feb00 ([`450f449`](https://github.com/taskforcesh/bullmq/commit/450f4490988e01a1f1a5ea054eb1ac87c384c831))

* chore(deps): update dependency pipenv to v2023.4.29 ([`dd82136`](https://github.com/taskforcesh/bullmq/commit/dd821365ab00efe1bb8bd663815ce300c4693449))

* chore(deps): lock file maintenance (#1864) ([`f2f1f2c`](https://github.com/taskforcesh/bullmq/commit/f2f1f2ca9c53ea8dd7e7d44557d039d822ddb9b9))

* chore(deps): lock file maintenance (#1851) ([`083b4d5`](https://github.com/taskforcesh/bullmq/commit/083b4d55ea67c75ae2a40c0545157cecd8e50508))

* chore(python): replace staticmethod function with decorator (#1826) ([`475a188`](https://github.com/taskforcesh/bullmq/commit/475a18863b678e72f4d3ba65af70e9d15c199333))

* chore(deps): update actions/checkout digest to 8e5e7e5 ([`59cca88`](https://github.com/taskforcesh/bullmq/commit/59cca889afe2205821201e74616b3c3326cfa0fc))

* chore(deps): update actions/setup-python digest to 57ded4d ([`182b4bb`](https://github.com/taskforcesh/bullmq/commit/182b4bb06a398b3a61ea070a7256d68cb77b86e6))

* chore(deps): update github/codeql-action digest to 7df0ce3 ([`ef7d3e0`](https://github.com/taskforcesh/bullmq/commit/ef7d3e0b1357ba3c302c22792cc5a58ea7850889))

* chore(python): move types into a subfolder (#1828) ([`5428ecb`](https://github.com/taskforcesh/bullmq/commit/5428ecb6524ddcf880402108e7daa73ed4c4807a))

* chore(deps): update dependency filelock to v3.12.0 ([`7919a59`](https://github.com/taskforcesh/bullmq/commit/7919a59c1c6f29de00cbea8cf60105cb9d87ba76))

* chore(deps): update dependency virtualenv to v20.22.0 ([`9c2c76c`](https://github.com/taskforcesh/bullmq/commit/9c2c76c41b7ac5a8d77d2ee3e4e905cba9e07e0b))

* chore(deps): update dependency pipenv to v2023.4.20 ([`b4234c9`](https://github.com/taskforcesh/bullmq/commit/b4234c9ad74af0e671cd3477aba47ffcc5a548c3))

### Documentation

* docs(python): add changelog (#1868) ([`e83f7d0`](https://github.com/taskforcesh/bullmq/commit/e83f7d0447471c24a753f0ad3e302a1eb85382d5))

* docs(repeatable): fix invalid cron expression in example (#1867) ([`4f31730`](https://github.com/taskforcesh/bullmq/commit/4f3173003464d3ef468271ad2394c1ca613f6077))

### Feature

* feat(python): add retry method into job (#1877) ([`870da45`](https://github.com/taskforcesh/bullmq/commit/870da459f419076f03885a12a4ce5a2930c500f3))

* feat(python): add updateData method (#1871) ([`800b8c4`](https://github.com/taskforcesh/bullmq/commit/800b8c46e709a8cbc4674d84bd59d5c62251d271))

* feat(python): support retryJob logic (#1869) ([`b044a03`](https://github.com/taskforcesh/bullmq/commit/b044a03159bc3a8d8823c71019f64825f318a6c2))

* feat(python): save stacktrace when job fails (#1859) ([`0b538ce`](https://github.com/taskforcesh/bullmq/commit/0b538cedf63c3f006838ee3d016e463ee3492f81))

* feat(python): add moveToDelayed job method (#1849) ([`5bebf8d`](https://github.com/taskforcesh/bullmq/commit/5bebf8d6560de78448b0413baaabd26f7227575c))

* feat(python): add updateProgress method in job class(#1830) ([`e1e1aa2`](https://github.com/taskforcesh/bullmq/commit/e1e1aa2e7a41e5418a5a50af4cea347a38bbc7d1))

* feat(python): accept redis options as string ([`01f549e`](https://github.com/taskforcesh/bullmq/commit/01f549e62a33619a7816758910a2d2b5ac75b589))

### Fix

* fix(worker): close open handles after closing (#1861) fixes #1312 ([`39286e8`](https://github.com/taskforcesh/bullmq/commit/39286e87e8ffabf641f229cf2da3db4c280f4637))

* fix(python): stop processes when force stop (#1837) ([`514699c`](https://github.com/taskforcesh/bullmq/commit/514699cd8be96db2320bf0f85d4b6593809a09f1))

### Refactor

* refactor(finished-on): save finishedOn on job methods (#1857) ([`5039369`](https://github.com/taskforcesh/bullmq/commit/503936909e004423536667720952e87fee90cff0))

### Test

* test(events): try to fix flaky test ([`8358e28`](https://github.com/taskforcesh/bullmq/commit/8358e28680fe85a51935052082475fb8fa5f9c06))

### Unknown

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`13b26eb`](https://github.com/taskforcesh/bullmq/commit/13b26eb377632133a7280258687b9f95bdabd2f4))


## v3.12.0 (2023-04-20)

### Chore

* chore(release): 3.12.0 [skip ci]

# [3.12.0](https://github.com/taskforcesh/bullmq/compare/v3.11.0...v3.12.0) (2023-04-20)

### Features

* upgrade ioredis to 5.3.2 ([375b1be](https://github.com/taskforcesh/bullmq/commit/375b1be52035e93c5fef6024e0d06aa723f602a9)) ([`fc66096`](https://github.com/taskforcesh/bullmq/commit/fc66096d79734ad543562dfdbd6739c080f7102f))

* chore(deps): update coverallsapp/github-action digest to d2cf009 (#1842) ([`c72bc17`](https://github.com/taskforcesh/bullmq/commit/c72bc1756faec43b7b67528f0f0bdacef193e005))

* chore(deps): lock file maintenance ([`10135f2`](https://github.com/taskforcesh/bullmq/commit/10135f23fc7a1c38da96715b296a271b0eaffb58))

* chore(deps): update dependency ioredis to v5.3.2 ([`3eff8e6`](https://github.com/taskforcesh/bullmq/commit/3eff8e66d2582c024e71149c6621671af99e363c))

### Documentation

* docs(bullmq-pro): update changelog (#1838) ([`13e838a`](https://github.com/taskforcesh/bullmq/commit/13e838a6cf3ccf2209cffdf09b9e2e53b8121e3e))

### Feature

* feat: upgrade ioredis to 5.3.2 ([`375b1be`](https://github.com/taskforcesh/bullmq/commit/375b1be52035e93c5fef6024e0d06aa723f602a9))

### Unknown

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`95f3243`](https://github.com/taskforcesh/bullmq/commit/95f3243b17cf5cf10361785bc95653d4dc45a917))

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`0514722`](https://github.com/taskforcesh/bullmq/commit/05147224c0f2e7df8a0298c999c8655d99ff011f))


## v3.11.0 (2023-04-17)

### Chore

* chore(release): 3.11.0 [skip ci]

# [3.11.0](https://github.com/taskforcesh/bullmq/compare/v3.10.4...v3.11.0) (2023-04-17)

### Bug Fixes

* **python:** correct condition so that the worker keeps processing jobs indefinitely ([#1800](https://github.com/taskforcesh/bullmq/issues/1800)) ([ef0c5d6](https://github.com/taskforcesh/bullmq/commit/ef0c5d6cae1dcbae607fa02da32d5236069f2339))

### Features

* **python:** add getJobCounts method ([#1807](https://github.com/taskforcesh/bullmq/issues/1807)) ([46d6f94](https://github.com/taskforcesh/bullmq/commit/46d6f94575454fe2a32be0c5247f16d18739fe27))
* **python:** improve worker concurrency ([#1809](https://github.com/taskforcesh/bullmq/issues/1809)) ([ec7c49e](https://github.com/taskforcesh/bullmq/commit/ec7c49e284fd1ecdd52b96197281247f5222ea34))
* **upstash:** don&#39;t throw an error when detecting an upstash host ([2e06bca](https://github.com/taskforcesh/bullmq/commit/2e06bca3615aafecd725d093045a510a67053fed)) ([`1a3113b`](https://github.com/taskforcesh/bullmq/commit/1a3113b97106eebd63883dc8865b7c6a3f028765))

* chore: remove extra parentheses ([`8bb76ab`](https://github.com/taskforcesh/bullmq/commit/8bb76ab3a71a38f2e8df7977a0c08cce31f8a202))

* chore(deps): update dependency semver to v7.4.0 ([`79f8363`](https://github.com/taskforcesh/bullmq/commit/79f8363cad94e206b0f6416657407b5d649be0b4))

* chore(python): replace is operator (#1819) ([`cd15d7d`](https://github.com/taskforcesh/bullmq/commit/cd15d7d46626511231f50f86c11898c6fa551c5b))

* chore(deps): lock file maintenance ([`13dcd76`](https://github.com/taskforcesh/bullmq/commit/13dcd76c4a567b3750388806cf7923ac6d5e2cb2))

* chore(python): remove unnecessary semicolons (#1801) ([`b4729e9`](https://github.com/taskforcesh/bullmq/commit/b4729e99622a802a09db9f8007b1039b4001b8fb))

* chore(python): add JobOptions to add method (#1798) ([`8d0cbda`](https://github.com/taskforcesh/bullmq/commit/8d0cbdad4006394be080f8dc6ffdf5f193afc5aa))

* chore(deps): update github/codeql-action digest to d186a2a ([`99e5f6f`](https://github.com/taskforcesh/bullmq/commit/99e5f6fa9c5f2f4bcb1ab321b6221da7548055fe))

* chore(python): add QueueOptions (#1797) ([`7478049`](https://github.com/taskforcesh/bullmq/commit/74780498a76849b7157af7688ea5b9c37c1c09dd))

* chore(python): add JobOptions (#1796) ([`893f71a`](https://github.com/taskforcesh/bullmq/commit/893f71a9d0309aef924fba4ec605d9fb4f6c0f68))

* chore(deps): update dependency filelock to v3.11.0 ([`21d7e14`](https://github.com/taskforcesh/bullmq/commit/21d7e141fa30762369d2804b7901dfab24271120))

* chore(python): add WorkerOptions typed dict  (#1795) ([`4843634`](https://github.com/taskforcesh/bullmq/commit/48436341230b495d9400948626c20db40761e2d1))

* chore(deps): pin actions/setup-python action to d27e3f3 ([`17ccf4f`](https://github.com/taskforcesh/bullmq/commit/17ccf4ff807179c9f65a9f4087fbb6671212f07c))

* chore(python): update python docs comments (#1790) ([`cb145ce`](https://github.com/taskforcesh/bullmq/commit/cb145cef8cc655deafbe10edef2f9540d1ca53cc))

### Documentation

* docs: fix type error in scheduled job example code (closes taskforcesh/bullmq#1815) ([`11e62c9`](https://github.com/taskforcesh/bullmq/commit/11e62c9241a9c25e811bc5d8e99405c3871bc67f))

* docs: fix typo ([`806f758`](https://github.com/taskforcesh/bullmq/commit/806f758df9ea0c3d1e42f39e2fa00f76a5f5d6c4))

* docs(clean): fix typo/grammar (#1812) ([`65c12df`](https://github.com/taskforcesh/bullmq/commit/65c12df09c2364f5b722da532825af918e3e1a59))

* docs(flows): add warning about queues configurations (#1805) ([`3bdde0f`](https://github.com/taskforcesh/bullmq/commit/3bdde0fed601e335a2f0b3f814c394eeaecad85d))

### Feature

* feat(upstash): don&#39;t throw an error when detecting an upstash host

Upstash is currently rolling out redis streams to all regions and will be compatible with bullmq. ([`2e06bca`](https://github.com/taskforcesh/bullmq/commit/2e06bca3615aafecd725d093045a510a67053fed))

* feat(python): add getJobCounts method (#1807) ([`46d6f94`](https://github.com/taskforcesh/bullmq/commit/46d6f94575454fe2a32be0c5247f16d18739fe27))

* feat(python): improve worker concurrency (#1809) ([`ec7c49e`](https://github.com/taskforcesh/bullmq/commit/ec7c49e284fd1ecdd52b96197281247f5222ea34))

### Fix

* fix(python): correct condition so that the worker keeps processing jobs indefinitely (#1800) ([`ef0c5d6`](https://github.com/taskforcesh/bullmq/commit/ef0c5d6cae1dcbae607fa02da32d5236069f2339))

### Refactor

* refactor(python): update getCompleted return type (#1820) ([`ac8a96b`](https://github.com/taskforcesh/bullmq/commit/ac8a96bafa72542ffc2c632a1059a1403e282bc6))

* refactor(python):  type hinting, remove white space, semicolon etc.. (#1818) ([`2dbb1ab`](https://github.com/taskforcesh/bullmq/commit/2dbb1ab74b11e2c894b96f44e64fe405a9126884))

### Unknown

* GITBOOK-157: change request with no subject merged in GitBook ([`6e436ca`](https://github.com/taskforcesh/bullmq/commit/6e436caa7929d9e123d424165a7a46490b2da0af))


## v3.10.4 (2023-04-05)

### Chore

* chore(release): 3.10.4 [skip ci]

## [3.10.4](https://github.com/taskforcesh/bullmq/compare/v3.10.3...v3.10.4) (2023-04-05)

### Bug Fixes

* **flow:** do not remove completed children results ([#1788](https://github.com/taskforcesh/bullmq/issues/1788)) fixes [#1778](https://github.com/taskforcesh/bullmq/issues/1778) ([04b547a](https://github.com/taskforcesh/bullmq/commit/04b547ad3df02cb94c499f7f26678e19c6797e7e))
* **python:** fix scripts typing on array2obj function ([#1786](https://github.com/taskforcesh/bullmq/issues/1786)) ([134f6ab](https://github.com/taskforcesh/bullmq/commit/134f6ab5f3219ddd7a421e61ace6bac72bb51e6d)) ([`86f5774`](https://github.com/taskforcesh/bullmq/commit/86f57742e3233853b944ae8616c1cfa5a16706c3))

* chore(deps): update peaceiris/actions-gh-pages digest to 373f7f2 ([`ef7d0e2`](https://github.com/taskforcesh/bullmq/commit/ef7d0e26882f875e0942a464c8ca3afcabea5436))

* chore(deps): update dependency platformdirs to v3.2.0 ([`268dd38`](https://github.com/taskforcesh/bullmq/commit/268dd388b30568c6f474409b2424eee2df63fde8))

* chore(python): add missing typings in python (#1789) ([`9e22393`](https://github.com/taskforcesh/bullmq/commit/9e22393a66dee10d339225e453b4a52cdd9f2104))

* chore(deps): update actions/checkout digest to 8f4b7f8 ([`d081c9f`](https://github.com/taskforcesh/bullmq/commit/d081c9f3eb761143fdf5bd630c1dc5ee9bc02bd9))

* chore(deps): update dependency redis to v4.5.4 [security] ([`60c3c23`](https://github.com/taskforcesh/bullmq/commit/60c3c2323deb6a073760dbd8f07d9874a444fab0))

* chore(deps): update supercharge/redis-github-action action to v1.5.0 ([`663f961`](https://github.com/taskforcesh/bullmq/commit/663f9617b751e55b85e0226bc12cdd94ecb1d527))

* chore(deps): lock file maintenance ([`b65fa9b`](https://github.com/taskforcesh/bullmq/commit/b65fa9b51fa2b8813f63b153a25ac781fa9b72d0))

* chore(deps): update dependency cron-parser to v4.8.1 ([`33a91eb`](https://github.com/taskforcesh/bullmq/commit/33a91eb9447d55e14347d1dc90c48e43f912c082))

* chore(deps): update dependency msgpackr to v1.8.5 ([`1b0f4e0`](https://github.com/taskforcesh/bullmq/commit/1b0f4e0b0fe797e346fe9a66e50946aa1d45cbdf))

* chore(deps): update dependency filelock to v3.10.7 ([`35955b7`](https://github.com/taskforcesh/bullmq/commit/35955b7363bff083d4e3d933c52a5dd96326e277))

* chore(deps): update dependency msgpack to v1.0.5 (#1731) ([`7ca07dd`](https://github.com/taskforcesh/bullmq/commit/7ca07ddfd46383863fbcdb383dcc800e05bd000a))

### Documentation

* docs(remove-jobs): add clean method description ([`85c3049`](https://github.com/taskforcesh/bullmq/commit/85c30493aa8f95277da07d1c12d9a4ab03648e5f))

* docs(pattern): add adding bulks section (#1782) ([`7785102`](https://github.com/taskforcesh/bullmq/commit/7785102c6905965c8e6bf39ee8c4992e6ed40ee7))

* docs(step-jobs): enhance documentation when throwing errors (#1774) ([`649aa6c`](https://github.com/taskforcesh/bullmq/commit/649aa6c7298083c808b73ce79ffa52351e9ec716))

* docs(flow-producer): add usage of addBulk method (#1773) ([`229c87e`](https://github.com/taskforcesh/bullmq/commit/229c87e9db144e26d23776b2e00ceb5467c0f0fb))

### Fix

* fix(flow): do not remove completed children results (#1788) fixes #1778 ([`04b547a`](https://github.com/taskforcesh/bullmq/commit/04b547ad3df02cb94c499f7f26678e19c6797e7e))

* fix(python): fix scripts typing on array2obj function (#1786) ([`134f6ab`](https://github.com/taskforcesh/bullmq/commit/134f6ab5f3219ddd7a421e61ace6bac72bb51e6d))

### Refactor

* refactor(python): replace string concatenation with string formatting ([`ba26f64`](https://github.com/taskforcesh/bullmq/commit/ba26f64932d4b90861c001ee54bd60bcc158e6c9))

### Test

* test(repeat): validate delayed records are deleted when removing repeatable (#1781) ([`3df8afb`](https://github.com/taskforcesh/bullmq/commit/3df8afb55725ac8e92a37ee132513fb5c7dc0051))


## v3.10.3 (2023-03-30)

### Chore

* chore(release): 3.10.3 [skip ci]

## [3.10.3](https://github.com/taskforcesh/bullmq/compare/v3.10.2...v3.10.3) (2023-03-30)

### Bug Fixes

* **flow:** consider removing dependency on removeOnFail true ([#1753](https://github.com/taskforcesh/bullmq/issues/1753)) ([de5a299](https://github.com/taskforcesh/bullmq/commit/de5a299f109834ab0235ae6fb6286fd94fcef961))
* **python:** pass maxMetricsSize as empty string when it is not provided fixes [#1754](https://github.com/taskforcesh/bullmq/issues/1754) ([6bda2b2](https://github.com/taskforcesh/bullmq/commit/6bda2b24be38a78e5fcfc71ed2913f0150a41dfc)) ([`8c34cc7`](https://github.com/taskforcesh/bullmq/commit/8c34cc7dcb71413a77b1e9f5bdb157d5b6d7a0ac))

* chore(deps): update dependency pipenv to v2023.3.20 ([`65d9c97`](https://github.com/taskforcesh/bullmq/commit/65d9c97f6e1d253a08bc7111bbdebdd825e3d647))

* chore(deps): update actions/setup-node digest to 64ed1c7 ([`accfeff`](https://github.com/taskforcesh/bullmq/commit/accfeff2751e5879bb43d3018ba3150628fe0428))

* chore(deps): update github/codeql-action digest to 04df126 ([`d604078`](https://github.com/taskforcesh/bullmq/commit/d604078b560090e1310e48512e01655414687a6a))

* chore(deps): update dependency redis to v4.5.3 [security] ([`f6e7124`](https://github.com/taskforcesh/bullmq/commit/f6e712432b57372052db25ea77e0da15821b07d2))

* chore(python): update README ([`4ea9642`](https://github.com/taskforcesh/bullmq/commit/4ea9642193e3a9ac9852314a6e3f21558eaa267b))

* chore(asyncfifoqueue): add TODO comment ([`38e0708`](https://github.com/taskforcesh/bullmq/commit/38e0708d12e52373b9882707b2676ad7f06070a4))

* chore(deps): update dependency platformdirs to v3 ([`2654023`](https://github.com/taskforcesh/bullmq/commit/265402339268acb5152a04571c641adfff22d5c0))

* chore(deps): update coverallsapp/github-action digest to 6674157 ([`5e2df99`](https://github.com/taskforcesh/bullmq/commit/5e2df99d1c8bff83940a17be83ec4e006f9f75d4))

* chore(deps): update dependency virtualenv to v20.21.0 ([`33b9f7d`](https://github.com/taskforcesh/bullmq/commit/33b9f7d731a439e6773311f0b590738776576caf))

### Documentation

* docs(step-jobs): add how to import errors (#1748) ([`d0cbb76`](https://github.com/taskforcesh/bullmq/commit/d0cbb7616853c2d9f5f87d4c61c39c02c7080855))

### Fix

* fix(flow): consider removing dependency on removeOnFail true (#1753) ([`de5a299`](https://github.com/taskforcesh/bullmq/commit/de5a299f109834ab0235ae6fb6286fd94fcef961))

* fix(python): pass maxMetricsSize as empty string when it is not provided fixes #1754 ([`6bda2b2`](https://github.com/taskforcesh/bullmq/commit/6bda2b24be38a78e5fcfc71ed2913f0150a41dfc))

### Unknown

* GITBOOK-156: change request with no subject merged in GitBook ([`f0b04af`](https://github.com/taskforcesh/bullmq/commit/f0b04af4c5268dc0df305c49c95be6b524e9dacc))

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`72eb6eb`](https://github.com/taskforcesh/bullmq/commit/72eb6ebeff12261777b86f2bc74a9cbbba1609f0))


## v3.10.2 (2023-03-22)

### Chore

* chore(release): 3.10.2 [skip ci]

## [3.10.2](https://github.com/taskforcesh/bullmq/compare/v3.10.1...v3.10.2) (2023-03-22)

### Bug Fixes

* **job:** avoid error when job is moved when processing ([#1354](https://github.com/taskforcesh/bullmq/issues/1354)) fixes [#1343](https://github.com/taskforcesh/bullmq/issues/1343) [#1602](https://github.com/taskforcesh/bullmq/issues/1602) ([78085e4](https://github.com/taskforcesh/bullmq/commit/78085e4304357dd3695df61057f91e706c3a52bf)) ([`358ab2a`](https://github.com/taskforcesh/bullmq/commit/358ab2a9179155659800d48edee0f1f77309bff1))

* chore(deps): update dependency filelock to v3.9.1 ([`a695dd9`](https://github.com/taskforcesh/bullmq/commit/a695dd917446cd3b10b3ac8aa7cdd5a71b7dfd86))

* chore(deps): update github/codeql-action digest to 168b99b ([`20b8417`](https://github.com/taskforcesh/bullmq/commit/20b841717335df7d9bb6f01c0f5bba7a563070f9))

### Documentation

* docs: expose async-fifo-queue (#1743) ([`922d118`](https://github.com/taskforcesh/bullmq/commit/922d118d4629e765e2f32e2bc5dae836a3e34f8b))

### Fix

* fix(job): avoid error when job is moved when processing (#1354) fixes #1343 #1602 ([`78085e4`](https://github.com/taskforcesh/bullmq/commit/78085e4304357dd3695df61057f91e706c3a52bf))


## v3.10.1 (2023-03-06)

### Chore

* chore(release): 3.10.1 [skip ci]

## [3.10.1](https://github.com/taskforcesh/bullmq/compare/v3.10.0...v3.10.1) (2023-03-06)

### Bug Fixes

* **worker:** throw error with invalid concurrency fixes [#1723](https://github.com/taskforcesh/bullmq/issues/1723) ([2a1cdbe](https://github.com/taskforcesh/bullmq/commit/2a1cdbe3e871309f460aadc14b4d632238c32aa9)) ([`5849cf6`](https://github.com/taskforcesh/bullmq/commit/5849cf686064bfb5f28ccb735ec47fb44553c5a8))

### Fix

* fix(worker): throw error with invalid concurrency fixes #1723 ([`2a1cdbe`](https://github.com/taskforcesh/bullmq/commit/2a1cdbe3e871309f460aadc14b4d632238c32aa9))

### Unknown

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`21c9de0`](https://github.com/taskforcesh/bullmq/commit/21c9de07001a6519fb12b32d87f760f8e481cb35))


## v3.10.0 (2023-03-02)

### Chore

* chore(release): 3.10.0 [skip ci]

# [3.10.0](https://github.com/taskforcesh/bullmq/compare/v3.9.0...v3.10.0) (2023-03-02)

### Bug Fixes

* **worker:** close lock extended timer ([7995f18](https://github.com/taskforcesh/bullmq/commit/7995f18bb7712bd50d0fa3d17c4ab565b16ab379))
* **worker:** correct lock extender logic ([6aa3569](https://github.com/taskforcesh/bullmq/commit/6aa3569db0fe0137790e61a4b5982d2b35ee5646))
* **worker:** start stalled check timer ([4763be0](https://github.com/taskforcesh/bullmq/commit/4763be028b0c7b0460fd0804d4569c446a06ef4a))

### Features

* **worker:** replace Promise.race with efficient an async fifo ([0d94e35](https://github.com/taskforcesh/bullmq/commit/0d94e35e805b09c3b4c7404b8a2eeb71a1aff5c4))
* **worker:** simplify lock extension to one call independent of concurrency ([ebf1aeb](https://github.com/taskforcesh/bullmq/commit/ebf1aeb2400383d0ae90ab68aeb4822aea03ba44))

### Performance Improvements

* **scripts:** reuse keys array to avoid allocations ([feac7b4](https://github.com/taskforcesh/bullmq/commit/feac7b4070a6a3720597af36c43d095e9ea37173))
* **worker:** improve worker memory consumption ([4846cf1](https://github.com/taskforcesh/bullmq/commit/4846cf1fe3f9ea35f58a679c11706e1a7101c898)) ([`4cb5250`](https://github.com/taskforcesh/bullmq/commit/4cb5250886f8f454a7ee4ee4d2b1754cd83df59b))

### Documentation

* docs(auto-removal): add worker auto-removal examples (#1715) ([`4069344`](https://github.com/taskforcesh/bullmq/commit/40693440b473cd311da6a33ce591e8094fd9fc92))

### Feature

* feat(worker): replace Promise.race with efficient an async fifo ([`0d94e35`](https://github.com/taskforcesh/bullmq/commit/0d94e35e805b09c3b4c7404b8a2eeb71a1aff5c4))

### Fix

* fix(worker): correct lock extender logic ([`6aa3569`](https://github.com/taskforcesh/bullmq/commit/6aa3569db0fe0137790e61a4b5982d2b35ee5646))

* fix(worker): close lock extended timer ([`7995f18`](https://github.com/taskforcesh/bullmq/commit/7995f18bb7712bd50d0fa3d17c4ab565b16ab379))

* fix(worker): start stalled check timer ([`4763be0`](https://github.com/taskforcesh/bullmq/commit/4763be028b0c7b0460fd0804d4569c446a06ef4a))

### Performance

* perf(scripts): reuse keys array to avoid allocations ([`feac7b4`](https://github.com/taskforcesh/bullmq/commit/feac7b4070a6a3720597af36c43d095e9ea37173))

* perf(worker): improve worker memory consumption ([`4846cf1`](https://github.com/taskforcesh/bullmq/commit/4846cf1fe3f9ea35f58a679c11706e1a7101c898))

### Test

* test(getters): skip flaky test for now ([`d0d4bf2`](https://github.com/taskforcesh/bullmq/commit/d0d4bf25ed1bae69405492b4744b675c6882e777))

* test(getters): add timeout for wait to ready ([`bd18ef4`](https://github.com/taskforcesh/bullmq/commit/bd18ef43913aa956c61b399cea81640cbb11f14d))

* test(getters): fix getWorkers() test for shared connections ([`4cbc9ca`](https://github.com/taskforcesh/bullmq/commit/4cbc9cacd994931750aa93699408e4c6e0e27c6f))

### Unknown

* Merge pull request #1706 from taskforcesh/feat/simplified-lock-extension

feat/several-memory-optimizations ([`0881eb1`](https://github.com/taskforcesh/bullmq/commit/0881eb1345d7c50da181b1ba73162174da50db53))

* Merge branch &#39;feat/simplified-lock-extension&#39; of https://github.com/taskforcesh/bullmq into feat/simplified-lock-extension ([`3a8293a`](https://github.com/taskforcesh/bullmq/commit/3a8293ab5948450ba027dea3c86ce98e5c97411c))

* Merge branch &#39;master&#39; into feat/simplified-lock-extension ([`4284eb9`](https://github.com/taskforcesh/bullmq/commit/4284eb90342efe19e04f547cca6d7586eb646c7b))

* GITBOOK-154: No subject ([`bd233a9`](https://github.com/taskforcesh/bullmq/commit/bd233a96f4b47a7565eb908f742a3f1aa694b859))

* Merge branch &#39;master&#39; into feat/simplified-lock-extension ([`b1d2dc8`](https://github.com/taskforcesh/bullmq/commit/b1d2dc8097ec83f8d56bf089ff7a6e0e4ceedcbc))

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`573c6cb`](https://github.com/taskforcesh/bullmq/commit/573c6cbefa91fb0f236ace4d0aeb980640414376))


## v3.9.0 (2023-02-25)

### Chore

* chore(release): 3.9.0 [skip ci]

# [3.9.0](https://github.com/taskforcesh/bullmq/compare/v3.8.0...v3.9.0) (2023-02-25)

### Features

* **worker:** add remove on complete and fail options ([#1703](https://github.com/taskforcesh/bullmq/issues/1703)) ([cf13494](https://github.com/taskforcesh/bullmq/commit/cf1349471dcbf0e43feea9972eaa71d2299d619f)) ([`3dc3b55`](https://github.com/taskforcesh/bullmq/commit/3dc3b55b787b49701dcf7aa74e85a216c774c231))

* chore(deps): bump json5 from 1.0.1 to 1.0.2 (#1613) ([`b58c6f3`](https://github.com/taskforcesh/bullmq/commit/b58c6f302b363720c2004dd2c1f7a7dfecf6640b))

### Feature

* feat(worker): add remove on complete and fail options (#1703) ([`cf13494`](https://github.com/taskforcesh/bullmq/commit/cf1349471dcbf0e43feea9972eaa71d2299d619f))


## v3.8.0 (2023-02-23)

### Chore

* chore(release): 3.8.0 [skip ci]

# [3.8.0](https://github.com/taskforcesh/bullmq/compare/v3.7.2...v3.8.0) (2023-02-23)

### Bug Fixes

* **worker:** run stalled check directly first time ([f71ec03](https://github.com/taskforcesh/bullmq/commit/f71ec03111a22897cbf2fad39073185e4aeac6d6))

### Features

* **worker:** add a public method to run the stalled checker ([3159266](https://github.com/taskforcesh/bullmq/commit/3159266ccb002d4fc71b7ee7ac63c465c536dbd1))
* **worker:** add support to disable stalled checks ([49e860c](https://github.com/taskforcesh/bullmq/commit/49e860c6675853971e992c2945b445660504e3b2)) ([`aa74246`](https://github.com/taskforcesh/bullmq/commit/aa742463f7dfbec433d166a42dfefd5b9248a544))

### Documentation

* docs(worker): improve options documentation ([`47740b8`](https://github.com/taskforcesh/bullmq/commit/47740b86332036c7c9a4cc80473544618b0454aa))

### Feature

* feat(worker): add a public method to run the stalled checker ([`3159266`](https://github.com/taskforcesh/bullmq/commit/3159266ccb002d4fc71b7ee7ac63c465c536dbd1))

* feat(worker): add support to disable stalled checks ([`49e860c`](https://github.com/taskforcesh/bullmq/commit/49e860c6675853971e992c2945b445660504e3b2))

### Fix

* fix(worker): run stalled check directly first time ([`f71ec03`](https://github.com/taskforcesh/bullmq/commit/f71ec03111a22897cbf2fad39073185e4aeac6d6))

### Test

* test(worker): renew lock high concurrency ([`5d25a37`](https://github.com/taskforcesh/bullmq/commit/5d25a37ecba93ace3114da95ca9cbc40145349bb))

### Unknown

* GITBOOK-153: No subject ([`a185d5e`](https://github.com/taskforcesh/bullmq/commit/a185d5e551162302a1236d9c52e4681d5b5ae2f5))


## v3.7.2 (2023-02-23)

### Chore

* chore(release): 3.7.2 [skip ci]

## [3.7.2](https://github.com/taskforcesh/bullmq/compare/v3.7.1...v3.7.2) (2023-02-23)

### Bug Fixes

* **worker:** restore failed event job parameter typing ([#1707](https://github.com/taskforcesh/bullmq/issues/1707)) ([44c2203](https://github.com/taskforcesh/bullmq/commit/44c2203ab65d406be9a913254600fe07c83e62d5)) ([`3ecb8f7`](https://github.com/taskforcesh/bullmq/commit/3ecb8f7fbb736e223aa73bbbf8f07629892902fa))

* chore(deps): lock file maintenance ([`0c85108`](https://github.com/taskforcesh/bullmq/commit/0c85108997b706ff2c52643d5752b0ed2e9c76a3))

### Feature

* feat(worker): simplify lock extension to one call independent of concurrency ([`ebf1aeb`](https://github.com/taskforcesh/bullmq/commit/ebf1aeb2400383d0ae90ab68aeb4822aea03ba44))

### Fix

* fix(worker): restore failed event job parameter typing (#1707) ([`44c2203`](https://github.com/taskforcesh/bullmq/commit/44c2203ab65d406be9a913254600fe07c83e62d5))

### Unknown

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`cc35401`](https://github.com/taskforcesh/bullmq/commit/cc35401963532293dd222defcb20864bab12c5f9))


## v3.7.1 (2023-02-22)

### Chore

* chore(release): 3.7.1 [skip ci]

## [3.7.1](https://github.com/taskforcesh/bullmq/compare/v3.7.0...v3.7.1) (2023-02-22)

### Bug Fixes

* **worker:** failed event receives an optional job parameter ([#1702](https://github.com/taskforcesh/bullmq/issues/1702)) fixes [#1690](https://github.com/taskforcesh/bullmq/issues/1690) ([6009906](https://github.com/taskforcesh/bullmq/commit/6009906355765bf00cba5c1505e9e0c6bf8f14db))

### Features

* **python:** add retryJobs method ([#1688](https://github.com/taskforcesh/bullmq/issues/1688)) ([2745327](https://github.com/taskforcesh/bullmq/commit/2745327c7a7080f72e8c265bae77429e597cb6d3))
* **python:** add trimEvents ([#1695](https://github.com/taskforcesh/bullmq/issues/1695)) ([ca48163](https://github.com/taskforcesh/bullmq/commit/ca48163263b12a85533563485176c684e548df0b)) ([`e465b55`](https://github.com/taskforcesh/bullmq/commit/e465b5574a19013868250658740b0fdda1d2c6f6))

* chore(deps): update dependency virtualenv to v20.19.0 (#1686) ([`2397d00`](https://github.com/taskforcesh/bullmq/commit/2397d0068f9fdf4036abddb0aca205f9e5ca8d54))

### Feature

* feat(python): add trimEvents (#1695) ([`ca48163`](https://github.com/taskforcesh/bullmq/commit/ca48163263b12a85533563485176c684e548df0b))

* feat(python): add retryJobs method (#1688) ([`2745327`](https://github.com/taskforcesh/bullmq/commit/2745327c7a7080f72e8c265bae77429e597cb6d3))

### Fix

* fix(worker): failed event receives an optional job parameter (#1702) fixes #1690 ([`6009906`](https://github.com/taskforcesh/bullmq/commit/6009906355765bf00cba5c1505e9e0c6bf8f14db))


## v3.7.0 (2023-02-16)

### Chore

* chore(release): 3.7.0 [skip ci]

# [3.7.0](https://github.com/taskforcesh/bullmq/compare/v3.6.6...v3.7.0) (2023-02-16)

### Features

* initial python package ([#1673](https://github.com/taskforcesh/bullmq/issues/1673)) ([a97b22f](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff)) ([`3b63c3e`](https://github.com/taskforcesh/bullmq/commit/3b63c3e629c1d63b6692f823fd83888f60a3a834))

* chore: prevent npm releases from python changes ([`3c2dacb`](https://github.com/taskforcesh/bullmq/commit/3c2dacb0952190afdf9d7262502c7df6dd1376c4))

* chore: remove unneeded argument ([`cac6f02`](https://github.com/taskforcesh/bullmq/commit/cac6f026b906274cba02e601f7496bfcfb42b18d))

* chore: remove unneeded argument ([`49bb158`](https://github.com/taskforcesh/bullmq/commit/49bb158daac81c6a84101e2b10e92da275e89031))

### Feature

* feat: initial python package (#1673)

* feat: initial python package

* chore: correct python actions

* style: delete white spaces

* feat(python): add isPaused method

* chore: add missing async

* feat(python): add more features to the python package

* chore: avoid trigger npm releases for python changes

* chore(python): better module handling

* fix(python): some lint errors

---------

Co-authored-by: rogger andré valverde flores &lt;rogger.valverde@uni.pe&gt; ([`a97b22f`](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff))

### Unknown

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`6e1cb47`](https://github.com/taskforcesh/bullmq/commit/6e1cb4722414be7fee485d5bc0cbdbc703c8a821))

* GITBOOK-152: No subject ([`af77b92`](https://github.com/taskforcesh/bullmq/commit/af77b92fa903c36c72ad18df97b9a4a22eebe88e))


## v3.6.6 (2023-02-15)

### Chore

* chore(release): 3.6.6 [skip ci]

## [3.6.6](https://github.com/taskforcesh/bullmq/compare/v3.6.5...v3.6.6) (2023-02-15)

### Bug Fixes

* **job:** check jobKey when saving stacktrace ([#1681](https://github.com/taskforcesh/bullmq/issues/1681)) fixes [#1676](https://github.com/taskforcesh/bullmq/issues/1676) ([1856c76](https://github.com/taskforcesh/bullmq/commit/1856c7684c377ca4fd36294cca8e128404be27b8)) ([`488f943`](https://github.com/taskforcesh/bullmq/commit/488f9437977f9aeb5a03b96a41dbb664dbfe2775))

* chore(deps): lock file maintenance (#1657) ([`762fd28`](https://github.com/taskforcesh/bullmq/commit/762fd28e8a64448c7cd054fac3507cefeecebf40))

### Fix

* fix(job): check jobKey when saving stacktrace (#1681) fixes #1676 ([`1856c76`](https://github.com/taskforcesh/bullmq/commit/1856c7684c377ca4fd36294cca8e128404be27b8))


## v3.6.5 (2023-02-11)

### Chore

* chore(release): 3.6.5 [skip ci]

## [3.6.5](https://github.com/taskforcesh/bullmq/compare/v3.6.4...v3.6.5) (2023-02-11)

### Bug Fixes

* infinite worker process spawned for invalid JS file ([a445ba8](https://github.com/taskforcesh/bullmq/commit/a445ba8b7a261b370dec7d88091ae5f5af8b2728)) ([`dfa431e`](https://github.com/taskforcesh/bullmq/commit/dfa431ebb22cebbf85247abcf8226946ad297ec5))

* chore: update bug template ([`f9e6ad3`](https://github.com/taskforcesh/bullmq/commit/f9e6ad3fac19c452ecab124a026244fe57b089e1))

* chore: add feature issue template ([`aca0371`](https://github.com/taskforcesh/bullmq/commit/aca03718275c2369bc0c36e5cfad093b82db4e52))

* chore: add issue template for bugs ([`327141c`](https://github.com/taskforcesh/bullmq/commit/327141ccae05b233bbb64f263fb9a34e50f8dfdc))

* chore(summary): remove duplicated nestjs section ([`3860d7c`](https://github.com/taskforcesh/bullmq/commit/3860d7cdf3c4dad5242b518ad57eaec5ec7981b3))

### Documentation

* docs(COC): update contact email ([`798e9cc`](https://github.com/taskforcesh/bullmq/commit/798e9cc1df4dcfa9d825e293aa642542b805657c))

* docs: add code of conduct ([`3caec65`](https://github.com/taskforcesh/bullmq/commit/3caec65a86ca7c9e9ced92c379f85b9f5407d850))

* docs(connections): make keyPrefix warning more pronounced (#1679) ([`422e9fc`](https://github.com/taskforcesh/bullmq/commit/422e9fcbcdf014c14c65b1811b3a8000230c1a91))

* docs(nestjs): add flow producer documentation (#1674) ([`6dc75a3`](https://github.com/taskforcesh/bullmq/commit/6dc75a3233de5c702e5dec10a8d202259b5e8637))

* docs(stalled): fix typos (#1672) ([`31c6896`](https://github.com/taskforcesh/bullmq/commit/31c6896b816776404e160b4b2bbe45e03fcc220a))

### Fix

* fix: infinite worker process spawned for invalid JS file ([`a445ba8`](https://github.com/taskforcesh/bullmq/commit/a445ba8b7a261b370dec7d88091ae5f5af8b2728))

### Test

* test(stalled): close queueEvents at the end of test ([`42be85b`](https://github.com/taskforcesh/bullmq/commit/42be85bf339615c9cd6ec6a92e3d1cc11f030228))

* test(stalled): add test for maxStalledCount &gt; 0 ([`6c10fae`](https://github.com/taskforcesh/bullmq/commit/6c10fae32a08bec016d895aab80576e262bae882))

* test(stalled): make sure Redis is clean of failed jobs ([`99ce98d`](https://github.com/taskforcesh/bullmq/commit/99ce98de8e384082aacaf6d2278c3f638eaa0146))


## v3.6.4 (2023-02-09)

### Chore

* chore(release): 3.6.4 [skip ci]

## [3.6.4](https://github.com/taskforcesh/bullmq/compare/v3.6.3...v3.6.4) (2023-02-09)

### Bug Fixes

* add a maximum block time ([1a2618b](https://github.com/taskforcesh/bullmq/commit/1a2618bc5473288a62dddb85e3cb78d6cdb4f39f)) ([`00ec4e8`](https://github.com/taskforcesh/bullmq/commit/00ec4e8d2d741df1246fb4e90ff876377fad7d16))

### Documentation

* docs(nestjs-bullmq-pro): add registerFlowProducer example ([`77ca996`](https://github.com/taskforcesh/bullmq/commit/77ca996d34652e75b4fed5475c871c830a3d00f3))

* docs(nestjs-bullmq-pro): add producers section (#1661) ([`94f2fd7`](https://github.com/taskforcesh/bullmq/commit/94f2fd749c132b463816a04727269c9fca32498c))

### Fix

* fix: add a maximum block time ([`1a2618b`](https://github.com/taskforcesh/bullmq/commit/1a2618bc5473288a62dddb85e3cb78d6cdb4f39f))

### Unknown

* GITBOOK-150: No subject ([`6ac5d0a`](https://github.com/taskforcesh/bullmq/commit/6ac5d0a5103f262a0a273265b3a72981019973d0))

* GITBOOK-149: No subject ([`4e6c3bd`](https://github.com/taskforcesh/bullmq/commit/4e6c3bdab20f7d18a13ac486607cbf00b279722f))


## v3.6.3 (2023-02-07)

### Chore

* chore(release): 3.6.3 [skip ci]

## [3.6.3](https://github.com/taskforcesh/bullmq/compare/v3.6.2...v3.6.3) (2023-02-07)

### Bug Fixes

* **master:** copy type declaration ([23ade6e](https://github.com/taskforcesh/bullmq/commit/23ade6e3e45df14bd3fbc2c3e7be47307b642872)) ([`bf8589a`](https://github.com/taskforcesh/bullmq/commit/bf8589ae1b95b705e921f597644becdd1752b04f))

### Documentation

* docs(nestjs): add nestjs-bullmq-pro changelog (#1655) ([`d681c22`](https://github.com/taskforcesh/bullmq/commit/d681c22982d1e5ca0d65fc2dd9e26de6f4370015))

### Fix

* fix(master): copy type declaration ([`23ade6e`](https://github.com/taskforcesh/bullmq/commit/23ade6e3e45df14bd3fbc2c3e7be47307b642872))


## v3.6.2 (2023-02-03)

### Build

* build(types): build types only once (#1652) ([`a104eb1`](https://github.com/taskforcesh/bullmq/commit/a104eb15adada64e3a2e79525baa335a6f2fa4d1))

### Chore

* chore(release): 3.6.2 [skip ci]

## [3.6.2](https://github.com/taskforcesh/bullmq/compare/v3.6.1...v3.6.2) (2023-02-03)

### Bug Fixes

* **redis:** increase minimum default retry time ([d521531](https://github.com/taskforcesh/bullmq/commit/d521531e22ba9eda8ad8d6e8eddf450fdc3f50f4)) ([`b08f95d`](https://github.com/taskforcesh/bullmq/commit/b08f95d9b87ec03b645af866ac869f771a42e1f1))

* chore: upgrade ioredis ([`e298c4e`](https://github.com/taskforcesh/bullmq/commit/e298c4e28f44f8c52ad4b85a1cf50870716ae479))

* chore(deps): update github/codeql-action digest to 3ebbd71 ([`f31ad20`](https://github.com/taskforcesh/bullmq/commit/f31ad20266cae66841074d6fb88309c4428108d7))

### Documentation

* docs(readme): use foo as queueName in example (#1651) ([`e3ba746`](https://github.com/taskforcesh/bullmq/commit/e3ba7465fa887afff99281167663f69e861feefc))

### Fix

* fix(redis): increase minimum default retry time ([`d521531`](https://github.com/taskforcesh/bullmq/commit/d521531e22ba9eda8ad8d6e8eddf450fdc3f50f4))

### Unknown

* GitBook: [#148] No subject ([`26a88a3`](https://github.com/taskforcesh/bullmq/commit/26a88a34abab10af9ebd4f7f22aefe5704f15c2d))

* GitBook: [#147] No subject ([`e625fbc`](https://github.com/taskforcesh/bullmq/commit/e625fbce30171acf5b88a1ac762bee2862dfc2f2))

* GitBook: [#146] No subject ([`fdf04be`](https://github.com/taskforcesh/bullmq/commit/fdf04be20acd72491571155b0bc022b6925f2fc0))

* GitBook: [#144] No subject ([`09b4694`](https://github.com/taskforcesh/bullmq/commit/09b4694e718a81aeb9dfd6048e016f6d48ca9209))

* GitBook: [#143] No subject ([`9c1758e`](https://github.com/taskforcesh/bullmq/commit/9c1758ea8e3b1ba7e054694f930648f408416b11))

* GitBook: [#141] No subject ([`2f81b39`](https://github.com/taskforcesh/bullmq/commit/2f81b397c010bd7305f5369b82f90a32b32c4ea8))

* GitBook: [#140] No subject ([`35d0147`](https://github.com/taskforcesh/bullmq/commit/35d01471cb63f3261527d10eebada67f0e4dbf9f))

* GitBook: [#139] No subject ([`a485b55`](https://github.com/taskforcesh/bullmq/commit/a485b55b9e028df57cb3dd006d683e88338ae10e))


## v3.6.1 (2023-01-31)

### Chore

* chore(release): 3.6.1 [skip ci]

## [3.6.1](https://github.com/taskforcesh/bullmq/compare/v3.6.0...v3.6.1) (2023-01-31)

### Bug Fixes

* **connection:** apply console.warn in noeviction message ([95f171c](https://github.com/taskforcesh/bullmq/commit/95f171cbc8cdd7d04865618b715dd21229f36a4a)) ([`75092f5`](https://github.com/taskforcesh/bullmq/commit/75092f50169154bfbbc704d8a1971b2ac0a03187))

### Fix

* fix(connection): apply console.warn in noeviction message ([`95f171c`](https://github.com/taskforcesh/bullmq/commit/95f171cbc8cdd7d04865618b715dd21229f36a4a))


## v3.6.0 (2023-01-31)

### Chore

* chore(release): 3.6.0 [skip ci]

# [3.6.0](https://github.com/taskforcesh/bullmq/compare/v3.5.11...v3.6.0) (2023-01-31)

### Features

* **job:** allow clearing job&#39;s log ([#1600](https://github.com/taskforcesh/bullmq/issues/1600)) ([0ded2d7](https://github.com/taskforcesh/bullmq/commit/0ded2d7709322bf105e0decac44d801ece5615f2)) ([`ce19e6d`](https://github.com/taskforcesh/bullmq/commit/ce19e6db253e03d5817b555abaa773a7bdf06171))

* chore(deps): lock file maintenance ([`35bd68b`](https://github.com/taskforcesh/bullmq/commit/35bd68b0214e27399e71d63db97a55d0f42936d0))

* chore(deps): update actions/checkout digest to ac59398 (#1582) ([`acebda8`](https://github.com/taskforcesh/bullmq/commit/acebda86b1e40e0a04dd3784b5fc3b7f1a662641))

* chore(deps): update peaceiris/actions-gh-pages digest to bd8c6b0 (#1632) ([`84e057e`](https://github.com/taskforcesh/bullmq/commit/84e057e3a84518be62607b8d8f9a7866aa3cd306))

### Documentation

* docs(nestjs): add nestjs-bullmq-pro api reference (#1646) ([`3e8fb1a`](https://github.com/taskforcesh/bullmq/commit/3e8fb1a8fa7a35ec2418b7326b139d73baed23cd))

### Feature

* feat(job): allow clearing job&#39;s log (#1600) ([`0ded2d7`](https://github.com/taskforcesh/bullmq/commit/0ded2d7709322bf105e0decac44d801ece5615f2))

### Unknown

* GitBook: [#138] No subject ([`cb6bf20`](https://github.com/taskforcesh/bullmq/commit/cb6bf2005d86c138126d1fe85caa9db05fa68551))


## v3.5.11 (2023-01-27)

### Chore

* chore(release): 3.5.11 [skip ci]

## [3.5.11](https://github.com/taskforcesh/bullmq/compare/v3.5.10...v3.5.11) (2023-01-27)

### Bug Fixes

* **error:** remove global prototype toJSON ([#1642](https://github.com/taskforcesh/bullmq/issues/1642)) fixes [#1414](https://github.com/taskforcesh/bullmq/issues/1414) ([d4e7108](https://github.com/taskforcesh/bullmq/commit/d4e7108a37aeabdd3085a26c9daf09cea5976f3e)) ([`94b293e`](https://github.com/taskforcesh/bullmq/commit/94b293e6011bed3f8b6905b202f7a45d0d1d863b))

### Fix

* fix(error): remove global prototype toJSON (#1642) fixes #1414 ([`d4e7108`](https://github.com/taskforcesh/bullmq/commit/d4e7108a37aeabdd3085a26c9daf09cea5976f3e))


## v3.5.10 (2023-01-24)

### Chore

* chore(release): 3.5.10 [skip ci]

## [3.5.10](https://github.com/taskforcesh/bullmq/compare/v3.5.9...v3.5.10) (2023-01-24)

### Bug Fixes

* **move-to-finished:** return correct delayUntil ([#1643](https://github.com/taskforcesh/bullmq/issues/1643)) ([c4bf9fa](https://github.com/taskforcesh/bullmq/commit/c4bf9fa6563eda1630d8eb2189b16e9324b01c7f)) ([`c66c03d`](https://github.com/taskforcesh/bullmq/commit/c66c03d377d6b5363231ec65117a8b045f136f86))

### Documentation

* docs(nestjs): add example link in nestjs-bullmq-pro ([`a444934`](https://github.com/taskforcesh/bullmq/commit/a4449342166e0194e1a9010e1771d90fa5a02e35))

### Fix

* fix(move-to-finished): return correct delayUntil (#1643) ([`c4bf9fa`](https://github.com/taskforcesh/bullmq/commit/c4bf9fa6563eda1630d8eb2189b16e9324b01c7f))


## v3.5.9 (2023-01-19)

### Chore

* chore(release): 3.5.9 [skip ci]

## [3.5.9](https://github.com/taskforcesh/bullmq/compare/v3.5.8...v3.5.9) (2023-01-19)

### Bug Fixes

* **worker:** fix delayed jobs with concurrency fixes [#1627](https://github.com/taskforcesh/bullmq/issues/1627) ([99a8e6d](https://github.com/taskforcesh/bullmq/commit/99a8e6d3a339be51fb46f69c8afac4ecdebff6d3)) ([`3714760`](https://github.com/taskforcesh/bullmq/commit/3714760ee4be056826e66baaec62bb97d60a53e3))

### Documentation

* docs(bullmq-pro): add nestjs-bullmq-pro module documentation (#1636) ([`9a0a83e`](https://github.com/taskforcesh/bullmq/commit/9a0a83ed97b3093451c6487cd59d515a9c676713))

### Fix

* fix(worker): fix delayed jobs with concurrency fixes #1627 ([`99a8e6d`](https://github.com/taskforcesh/bullmq/commit/99a8e6d3a339be51fb46f69c8afac4ecdebff6d3))

### Test

* test: reuse queue instance from test suite ([`f50910b`](https://github.com/taskforcesh/bullmq/commit/f50910bdc9fa1f4bbcd328fb8ffab252d5d0a9aa))


## v3.5.8 (2023-01-18)

### Chore

* chore(release): 3.5.8 [skip ci]

## [3.5.8](https://github.com/taskforcesh/bullmq/compare/v3.5.7...v3.5.8) (2023-01-18)

### Bug Fixes

* **move-to-active:** delete marker when it is moved to active ([#1634](https://github.com/taskforcesh/bullmq/issues/1634)) ([ad1fcea](https://github.com/taskforcesh/bullmq/commit/ad1fcea4500d4ceed51d5d5b0a03dbb5e1735a42)) ([`5c761ae`](https://github.com/taskforcesh/bullmq/commit/5c761ae994c48402b27a6b3530a882b0720e4025))

### Fix

* fix(move-to-active): delete marker when it is moved to active (#1634) ([`ad1fcea`](https://github.com/taskforcesh/bullmq/commit/ad1fcea4500d4ceed51d5d5b0a03dbb5e1735a42))


## v3.5.7 (2023-01-17)

### Chore

* chore(release): 3.5.7 [skip ci]

## [3.5.7](https://github.com/taskforcesh/bullmq/compare/v3.5.6...v3.5.7) (2023-01-17)

### Bug Fixes

* **move-to-active:** validate next marker and return delayUntil ([#1630](https://github.com/taskforcesh/bullmq/issues/1630)) ([3cd3305](https://github.com/taskforcesh/bullmq/commit/3cd33052fc711a9ba560c9a431630be5cdd02193)) ([`f2c1775`](https://github.com/taskforcesh/bullmq/commit/f2c1775dc150e3f1fd972beed39dcdd2b12e8ea1))

* chore(deps): bump luxon from 3.1.1 to 3.2.1 (#1621) ([`b203d0f`](https://github.com/taskforcesh/bullmq/commit/b203d0f80ff020242ee94e61899f7510e7d18b4d))

### Documentation

* docs(bullmq-pro): add 5.1.11 changelog ([`d33baf8`](https://github.com/taskforcesh/bullmq/commit/d33baf8d7e37c7f535215400229f32a1f238ed0d))

### Fix

* fix(move-to-active): validate next marker and return delayUntil (#1630) ([`3cd3305`](https://github.com/taskforcesh/bullmq/commit/3cd33052fc711a9ba560c9a431630be5cdd02193))


## v3.5.6 (2023-01-13)

### Chore

* chore(release): 3.5.6 [skip ci]

## [3.5.6](https://github.com/taskforcesh/bullmq/compare/v3.5.5...v3.5.6) (2023-01-13)

### Bug Fixes

* **worker:** add max concurrency from the beginning ([#1597](https://github.com/taskforcesh/bullmq/issues/1597)) fixes [#1589](https://github.com/taskforcesh/bullmq/issues/1589) ([6f49db3](https://github.com/taskforcesh/bullmq/commit/6f49db3fb15119d13f99cd83d49f2a7bdcb614cd)) ([`4de7f3c`](https://github.com/taskforcesh/bullmq/commit/4de7f3cf740ad1f96f07bdfcd50e372257df4514))

### Fix

* fix(worker): add max concurrency from the beginning (#1597) fixes #1589 ([`6f49db3`](https://github.com/taskforcesh/bullmq/commit/6f49db3fb15119d13f99cd83d49f2a7bdcb614cd))

### Test

* test(rate-limit): add flow case ([`cc631a6`](https://github.com/taskforcesh/bullmq/commit/cc631a681a501de16034b81389bd57b89169bf81))


## v3.5.5 (2023-01-10)

### Chore

* chore(release): 3.5.5 [skip ci]

## [3.5.5](https://github.com/taskforcesh/bullmq/compare/v3.5.4...v3.5.5) (2023-01-10)

### Bug Fixes

* circular references ([#1622](https://github.com/taskforcesh/bullmq/issues/1622)) ([f607ec7](https://github.com/taskforcesh/bullmq/commit/f607ec7530fb4430e8cab7ed325583bd9d171ccf)) ([`5a78f58`](https://github.com/taskforcesh/bullmq/commit/5a78f58ead461192069e78bf1ee34d84012e8077))

### Fix

* fix: circular references (#1622) ([`f607ec7`](https://github.com/taskforcesh/bullmq/commit/f607ec7530fb4430e8cab7ed325583bd9d171ccf))


## v3.5.4 (2023-01-09)

### Chore

* chore(release): 3.5.4 [skip ci]

## [3.5.4](https://github.com/taskforcesh/bullmq/compare/v3.5.3...v3.5.4) (2023-01-09)

### Bug Fixes

* [#1603](https://github.com/taskforcesh/bullmq/issues/1603) performance issues in `remove()` ([#1607](https://github.com/taskforcesh/bullmq/issues/1607)) ([2541215](https://github.com/taskforcesh/bullmq/commit/2541215bcf81dcd52eaefa02530c3812a5135fbf)) ([`9fdac55`](https://github.com/taskforcesh/bullmq/commit/9fdac5578795900b85c99b4ef8c2e71583802417))

### Fix

* fix: #1603 performance issues in `remove()` (#1607) ([`2541215`](https://github.com/taskforcesh/bullmq/commit/2541215bcf81dcd52eaefa02530c3812a5135fbf))


## v3.5.3 (2023-01-07)

### Chore

* chore(release): 3.5.3 [skip ci]

## [3.5.3](https://github.com/taskforcesh/bullmq/compare/v3.5.2...v3.5.3) (2023-01-07)

### Bug Fixes

* **delayed:** remove marker after being consumed ([#1620](https://github.com/taskforcesh/bullmq/issues/1620)) fixes [#1615](https://github.com/taskforcesh/bullmq/issues/1615) ([9fce0f0](https://github.com/taskforcesh/bullmq/commit/9fce0f05e5acc1918a276b03e8cb9c16083cb509)) ([`2061624`](https://github.com/taskforcesh/bullmq/commit/2061624f0baebd5e5018136934346b65750c0323))

* chore(deps): update peaceiris/actions-gh-pages digest to 64b46b4 (#1619) ([`4a6db4d`](https://github.com/taskforcesh/bullmq/commit/4a6db4db9bfcbe4a67b07b25b389f5bd1bee51ca))

### Documentation

* docs(guide): nestjs section (#1610) ([`1276e2b`](https://github.com/taskforcesh/bullmq/commit/1276e2bc62e39db3b24e0ba3f0824904ca4b595e))

### Fix

* fix(delayed): remove marker after being consumed (#1620) fixes #1615 ([`9fce0f0`](https://github.com/taskforcesh/bullmq/commit/9fce0f05e5acc1918a276b03e8cb9c16083cb509))


## v3.5.2 (2023-01-04)

### Chore

* chore(release): 3.5.2 [skip ci]

## [3.5.2](https://github.com/taskforcesh/bullmq/compare/v3.5.1...v3.5.2) (2023-01-04)

### Performance Improvements

* **get-dependencies:** replace slow object destructuring with single object ([#1612](https://github.com/taskforcesh/bullmq/issues/1612)) ([621748e](https://github.com/taskforcesh/bullmq/commit/621748ec7727b46ce57eb9d2b46ef981874cdf4c)) ([`5b34b8b`](https://github.com/taskforcesh/bullmq/commit/5b34b8ba09e14bc78aeed03824b4fbd419e0e18e))

### Documentation

* docs(readme): add nestjs module ([`2dad0d4`](https://github.com/taskforcesh/bullmq/commit/2dad0d4708574704d7f59bb048334957bb2474fe))

* docs(bullmq-pro): update changelog to version 5.1.10 ([`6f995f7`](https://github.com/taskforcesh/bullmq/commit/6f995f7b11a918a91108d18cb58d151a428da370))

### Performance

* perf(get-dependencies): replace slow object destructuring with single object (#1612) ([`621748e`](https://github.com/taskforcesh/bullmq/commit/621748ec7727b46ce57eb9d2b46ef981874cdf4c))

### Test

* test(connection): expect ioredis prefix errors (#1601) ([`d1b6920`](https://github.com/taskforcesh/bullmq/commit/d1b69204ddede7c80c9e327228d39506c60a797d))


## v3.5.1 (2022-12-23)

### Chore

* chore(release): 3.5.1 [skip ci]

## [3.5.1](https://github.com/taskforcesh/bullmq/compare/v3.5.0...v3.5.1) (2022-12-23)

### Bug Fixes

* **connection:** throw exception if using keyPrefix in ioredis ([eb6a130](https://github.com/taskforcesh/bullmq/commit/eb6a1305541547725e1717eefe2b678bc445f4d0))
* **connection:** use includes to check for upstash more reliably ([12efb5c](https://github.com/taskforcesh/bullmq/commit/12efb5c539cb6f031ea6f3a80e4128d2e556e627)) ([`1e8786a`](https://github.com/taskforcesh/bullmq/commit/1e8786a8dd2f08de6f84e08aeb252b304ebbca73))

### Fix

* fix(connection): throw exception if using keyPrefix in ioredis ([`eb6a130`](https://github.com/taskforcesh/bullmq/commit/eb6a1305541547725e1717eefe2b678bc445f4d0))

* fix(connection): use includes to check for upstash more reliably ([`12efb5c`](https://github.com/taskforcesh/bullmq/commit/12efb5c539cb6f031ea6f3a80e4128d2e556e627))

### Test

* test(connection): add test to verify cluster connection using dsn strings ([`a361a8e`](https://github.com/taskforcesh/bullmq/commit/a361a8e77766e1acb31151dc44b96eb4bff65386))


## v3.5.0 (2022-12-20)

### Chore

* chore(release): 3.5.0 [skip ci]

# [3.5.0](https://github.com/taskforcesh/bullmq/compare/v3.4.2...v3.5.0) (2022-12-20)

### Bug Fixes

* **job:** fetch parent before job moves to complete ([#1580](https://github.com/taskforcesh/bullmq/issues/1580)) ([6a6c0dc](https://github.com/taskforcesh/bullmq/commit/6a6c0dca30bb0a2417e0c62d4c80202c750322dd))
* **sandbox:** throw error when no exported function ([#1588](https://github.com/taskforcesh/bullmq/issues/1588)) fixes [#1587](https://github.com/taskforcesh/bullmq/issues/1587) ([c031891](https://github.com/taskforcesh/bullmq/commit/c03189184c8eeeb324f005b86e93d114abbe2154))

### Features

* **queue:** add getJobState method ([#1593](https://github.com/taskforcesh/bullmq/issues/1593)) ref [#1532](https://github.com/taskforcesh/bullmq/issues/1532) ([b741e84](https://github.com/taskforcesh/bullmq/commit/b741e8456f262b51aa7c68f571c76a3c54d02d37)) ([`ffb0851`](https://github.com/taskforcesh/bullmq/commit/ffb08512271be681204a803508cd4d5ece0bb71b))

* chore(deps): lock file maintenance (#1568) ([`a426e49`](https://github.com/taskforcesh/bullmq/commit/a426e499299f9782128106127285ddba2444ff58))

### Documentation

* docs(bullmq): add manual rate-limit section (#1590) ([`3fa5d33`](https://github.com/taskforcesh/bullmq/commit/3fa5d33861e99c1405a576b5ef7171daae4c16bb))

### Feature

* feat(queue): add getJobState method (#1593) ref #1532 ([`b741e84`](https://github.com/taskforcesh/bullmq/commit/b741e8456f262b51aa7c68f571c76a3c54d02d37))

### Fix

* fix(sandbox): throw error when no exported function (#1588) fixes #1587 ([`c031891`](https://github.com/taskforcesh/bullmq/commit/c03189184c8eeeb324f005b86e93d114abbe2154))

* fix(job): fetch parent before job moves to complete (#1580) ([`6a6c0dc`](https://github.com/taskforcesh/bullmq/commit/6a6c0dca30bb0a2417e0c62d4c80202c750322dd))


## v3.4.2 (2022-12-15)

### Chore

* chore(release): 3.4.2 [skip ci]

## [3.4.2](https://github.com/taskforcesh/bullmq/compare/v3.4.1...v3.4.2) (2022-12-15)

### Performance Improvements

* **counts:** delete delayed marker when needed ([#1583](https://github.com/taskforcesh/bullmq/issues/1583)) ([cc26f1c](https://github.com/taskforcesh/bullmq/commit/cc26f1cd550de76c7588d3a98187b80ee78c40c4))
* **get-children-values:** replace slow object destructuring with single object ([#1586](https://github.com/taskforcesh/bullmq/issues/1586)) ([857d403](https://github.com/taskforcesh/bullmq/commit/857d40377a6eb2c0101e6d16d9085ecd4b52b016)) ([`91bbde9`](https://github.com/taskforcesh/bullmq/commit/91bbde9472ea3b38e1b9ee94ef1ec56733eeb3fa))

### Documentation

* docs: add api references (#1584) ([`a3df041`](https://github.com/taskforcesh/bullmq/commit/a3df04109d64bc2b5de30f7b4fb95d5a836df949))

### Performance

* perf(counts): delete delayed marker when needed (#1583) ([`cc26f1c`](https://github.com/taskforcesh/bullmq/commit/cc26f1cd550de76c7588d3a98187b80ee78c40c4))

* perf(get-children-values): replace slow object destructuring with single object (#1586) ([`857d403`](https://github.com/taskforcesh/bullmq/commit/857d40377a6eb2c0101e6d16d9085ecd4b52b016))


## v3.4.1 (2022-12-10)

### Chore

* chore(release): 3.4.1 [skip ci]

## [3.4.1](https://github.com/taskforcesh/bullmq/compare/v3.4.0...v3.4.1) (2022-12-10)

### Bug Fixes

* **exponential:** respect exponential backoff delay ([#1581](https://github.com/taskforcesh/bullmq/issues/1581)) ([145dd32](https://github.com/taskforcesh/bullmq/commit/145dd329bb9f8254b404f4c5fbf7a50359202d37))
* **get-jobs:** filter marker ([#1551](https://github.com/taskforcesh/bullmq/issues/1551)) ([4add0ef](https://github.com/taskforcesh/bullmq/commit/4add0efa7857cc2f7b6d3c0c78a7f82cb7a46933)) ([`df604c4`](https://github.com/taskforcesh/bullmq/commit/df604c48bfeec2b621fd9d52d97b316f477e79a2))

### Fix

* fix(get-jobs): filter marker (#1551) ([`4add0ef`](https://github.com/taskforcesh/bullmq/commit/4add0efa7857cc2f7b6d3c0c78a7f82cb7a46933))

* fix(exponential): respect exponential backoff delay (#1581) ([`145dd32`](https://github.com/taskforcesh/bullmq/commit/145dd329bb9f8254b404f4c5fbf7a50359202d37))

### Test

* test(repeat): fix flaky tests (#1578) ([`8f9eefd`](https://github.com/taskforcesh/bullmq/commit/8f9eefda9f932535de8e452c926029eb6fdae435))


## v3.4.0 (2022-12-09)

### Chore

* chore(release): 3.4.0 [skip ci]

# [3.4.0](https://github.com/taskforcesh/bullmq/compare/v3.3.5...v3.4.0) (2022-12-09)

### Features

* **worker:** add ready event for blockingConnection ([#1577](https://github.com/taskforcesh/bullmq/issues/1577)) ([992cc9e](https://github.com/taskforcesh/bullmq/commit/992cc9e9b3046185d3b67f2cc956f30337f458e1)) ([`6d9dada`](https://github.com/taskforcesh/bullmq/commit/6d9dadaedf016267255e2412ff4ca40d44001630))

### Feature

* feat(worker): add ready event for blockingConnection (#1577) ([`992cc9e`](https://github.com/taskforcesh/bullmq/commit/992cc9e9b3046185d3b67f2cc956f30337f458e1))


## v3.3.5 (2022-12-08)

### Chore

* chore(release): 3.3.5 [skip ci]

## [3.3.5](https://github.com/taskforcesh/bullmq/compare/v3.3.4...v3.3.5) (2022-12-08)

### Bug Fixes

* **worker:** add token postfix ([#1575](https://github.com/taskforcesh/bullmq/issues/1575)) ([1d3e368](https://github.com/taskforcesh/bullmq/commit/1d3e368021041bb9861761c86fe3e04914b0c52f)) ([`865c9ca`](https://github.com/taskforcesh/bullmq/commit/865c9ca8ce99860a4a0c72b7a2ec4a5733395d10))

### Fix

* fix(worker): add token postfix (#1575) ([`1d3e368`](https://github.com/taskforcesh/bullmq/commit/1d3e368021041bb9861761c86fe3e04914b0c52f))


## v3.3.4 (2022-12-07)

### Chore

* chore(release): 3.3.4 [skip ci]

## [3.3.4](https://github.com/taskforcesh/bullmq/compare/v3.3.3...v3.3.4) (2022-12-07)

### Bug Fixes

* **worker:** try catch setname call ([#1576](https://github.com/taskforcesh/bullmq/issues/1576)) fixes [#1574](https://github.com/taskforcesh/bullmq/issues/1574) ([0c42fd8](https://github.com/taskforcesh/bullmq/commit/0c42fd8c07dbac7ace81e97e45440af93fc622a5)) ([`bbe29ee`](https://github.com/taskforcesh/bullmq/commit/bbe29ee8546242a839b41ae0eccd5c9acc592e9a))

### Fix

* fix(worker): try catch setname call (#1576) fixes #1574 ([`0c42fd8`](https://github.com/taskforcesh/bullmq/commit/0c42fd8c07dbac7ace81e97e45440af93fc622a5))


## v3.3.3 (2022-12-07)

### Chore

* chore(release): 3.3.3 [skip ci]

## [3.3.3](https://github.com/taskforcesh/bullmq/compare/v3.3.2...v3.3.3) (2022-12-07)

### Bug Fixes

* do not allow move from active to wait if not owner of the job ([dc1a307](https://github.com/taskforcesh/bullmq/commit/dc1a3077d1521c5dc99824a7fc05d17da03906bc)) ([`0f119cb`](https://github.com/taskforcesh/bullmq/commit/0f119cb7eac550ad6a5a08f6561b65a72d06ae91))

### Fix

* fix: do not allow move from active to wait if not owner of the job ([`dc1a307`](https://github.com/taskforcesh/bullmq/commit/dc1a3077d1521c5dc99824a7fc05d17da03906bc))


## v3.3.2 (2022-12-05)

### Chore

* chore(release): 3.3.2 [skip ci]

## [3.3.2](https://github.com/taskforcesh/bullmq/compare/v3.3.1...v3.3.2) (2022-12-05)

### Bug Fixes

* floor pexpire to integer ([1d5de42](https://github.com/taskforcesh/bullmq/commit/1d5de425a19ebf879a8f9a7e0543d87a4d358be1)) ([`b469dcc`](https://github.com/taskforcesh/bullmq/commit/b469dcc4bafee0bc21a6fc51772ce958947ce516))

### Fix

* fix: floor pexpire to integer ([`1d5de42`](https://github.com/taskforcesh/bullmq/commit/1d5de425a19ebf879a8f9a7e0543d87a4d358be1))


## v3.3.1 (2022-12-05)

### Chore

* chore(release): 3.3.1 [skip ci]

## [3.3.1](https://github.com/taskforcesh/bullmq/compare/v3.3.0...v3.3.1) (2022-12-05)

### Bug Fixes

* **get-workers:** set name when ready event in connection ([#1564](https://github.com/taskforcesh/bullmq/issues/1564)) ([de93c17](https://github.com/taskforcesh/bullmq/commit/de93c172901650e1666c48423a39076f2c7b9c7b))
* **job:** console warn custom job ids when they represent integers ([#1569](https://github.com/taskforcesh/bullmq/issues/1569)) ([6e677d2](https://github.com/taskforcesh/bullmq/commit/6e677d2800957b368bef4247b8e4328c5758f262)) ([`1e0625e`](https://github.com/taskforcesh/bullmq/commit/1e0625eb72400891b126483e1201431bbb7fd161))

### Fix

* fix(get-workers): set name when ready event in connection (#1564) ([`de93c17`](https://github.com/taskforcesh/bullmq/commit/de93c172901650e1666c48423a39076f2c7b9c7b))

* fix(job): console warn custom job ids when they represent integers (#1569) ([`6e677d2`](https://github.com/taskforcesh/bullmq/commit/6e677d2800957b368bef4247b8e4328c5758f262))


## v3.3.0 (2022-12-04)

### Chore

* chore(release): 3.3.0 [skip ci]

# [3.3.0](https://github.com/taskforcesh/bullmq/compare/v3.2.5...v3.3.0) (2022-12-04)

### Features

* **queue-events:** support duplicated event ([#1549](https://github.com/taskforcesh/bullmq/issues/1549)) ([18bc4eb](https://github.com/taskforcesh/bullmq/commit/18bc4eb50432f8aa27f2395750a7617317b66ca1)) ([`aa753dd`](https://github.com/taskforcesh/bullmq/commit/aa753dd3680964bf0fe7ab650734c12525020ef2))

### Feature

* feat(queue-events): support duplicated event (#1549) ([`18bc4eb`](https://github.com/taskforcesh/bullmq/commit/18bc4eb50432f8aa27f2395750a7617317b66ca1))


## v3.2.5 (2022-12-04)

### Chore

* chore(release): 3.2.5 [skip ci]

## [3.2.5](https://github.com/taskforcesh/bullmq/compare/v3.2.4...v3.2.5) (2022-12-04)

### Bug Fixes

* **add-job:** throw error when jobId represents an integer ([#1556](https://github.com/taskforcesh/bullmq/issues/1556)) ([db617d7](https://github.com/taskforcesh/bullmq/commit/db617d79e8f55b5c9e0df4b6bfd4247612016da1)) ([`75ebd85`](https://github.com/taskforcesh/bullmq/commit/75ebd8558853969df094d8c37b12b66685108eb9))

### Fix

* fix(add-job): throw error when jobId represents an integer (#1556) ([`db617d7`](https://github.com/taskforcesh/bullmq/commit/db617d79e8f55b5c9e0df4b6bfd4247612016da1))

### Refactor

* refactor(lodash): replace flatten and fromPairs functions (#854) ([`34431f9`](https://github.com/taskforcesh/bullmq/commit/34431f90e025cc2d8f0eb88a04c21e4f41d43487))


## v3.2.4 (2022-11-29)

### Chore

* chore(release): 3.2.4 [skip ci]

## [3.2.4](https://github.com/taskforcesh/bullmq/compare/v3.2.3...v3.2.4) (2022-11-29)

### Bug Fixes

* **add-job:** do not update job that already exist ([#1550](https://github.com/taskforcesh/bullmq/issues/1550)) ([26f6311](https://github.com/taskforcesh/bullmq/commit/26f6311cd0d2b936e404d0abebca9637f314a209)) ([`4387d0c`](https://github.com/taskforcesh/bullmq/commit/4387d0c959d563eaaba2719d3f9566e992ba0914))

* chore(deps): update github/codeql-action digest to 312e093 ([`a64f8b3`](https://github.com/taskforcesh/bullmq/commit/a64f8b38d76a68b52b1a6b6783bdc3fd4593add8))

* chore(deps): lock file maintenance ([`b06abd9`](https://github.com/taskforcesh/bullmq/commit/b06abd9eef33fa0a319e03f71d504d9c458f0ad7))

### Ci

* ci: harden release and test permissions (#1554) ([`cc37e76`](https://github.com/taskforcesh/bullmq/commit/cc37e7608cb44c0ee4dd975c48b423ad789fdb6e))

### Documentation

* docs: update BullMQ Pro changelog ([`0dfc2c9`](https://github.com/taskforcesh/bullmq/commit/0dfc2c9b79f13dacc96b5fd9110c5da9c1985cc9))

### Fix

* fix(add-job): do not update job that already exist (#1550) ([`26f6311`](https://github.com/taskforcesh/bullmq/commit/26f6311cd0d2b936e404d0abebca9637f314a209))

### Unknown

* GitBook: [#134] No subject ([`b2841eb`](https://github.com/taskforcesh/bullmq/commit/b2841eb4b12aac0f1aff93746ff5b211d3a48a7e))


## v3.2.3 (2022-11-29)

### Chore

* chore(release): 3.2.3 [skip ci]

## [3.2.3](https://github.com/taskforcesh/bullmq/compare/v3.2.2...v3.2.3) (2022-11-29)

### Bug Fixes

* **rate-limit:** delete rateLimiterKey when 0 ([#1553](https://github.com/taskforcesh/bullmq/issues/1553)) ([0b88e5b](https://github.com/taskforcesh/bullmq/commit/0b88e5b94b4a0dc0d4000f7fd4b327f402248ad2)) ([`a6b7498`](https://github.com/taskforcesh/bullmq/commit/a6b74988e38ff74049df9b30215fb6ddab73e844))

* chore(deps): lock file maintenance (#1491) ([`e67c057`](https://github.com/taskforcesh/bullmq/commit/e67c0575f855202bad47eb6616c35c07513fa1a7))

### Documentation

* docs: add missing - on param descriptions ([`84c0fe7`](https://github.com/taskforcesh/bullmq/commit/84c0fe7478983bc1d763da1936c5547772ef4d5f))

### Fix

* fix(rate-limit): delete rateLimiterKey when 0 (#1553) ([`0b88e5b`](https://github.com/taskforcesh/bullmq/commit/0b88e5b94b4a0dc0d4000f7fd4b327f402248ad2))

### Test

* test(repeat): fix flaky test ([`b09569b`](https://github.com/taskforcesh/bullmq/commit/b09569b562ae7aba3abdba06550e07f4a1c9dbe6))

### Unknown

* GitBook: [#133] No subject ([`f0535a9`](https://github.com/taskforcesh/bullmq/commit/f0535a950ff350a947caea2b9be6973b3417e55b))

* GitBook: [#132] No subject ([`240ef6b`](https://github.com/taskforcesh/bullmq/commit/240ef6bacd91ecc40f69bba3a46294f3b9aad3ec))

* GitBook: [#131] No subject ([`fac0391`](https://github.com/taskforcesh/bullmq/commit/fac039125f71f247f56e58241b8370ea7db815c9))

* GitBook: [#130] No subject ([`2a59136`](https://github.com/taskforcesh/bullmq/commit/2a591360c98888187b8de37f2ff139c56d95d369))


## v3.2.2 (2022-11-15)

### Chore

* chore(release): 3.2.2 [skip ci]

## [3.2.2](https://github.com/taskforcesh/bullmq/compare/v3.2.1...v3.2.2) (2022-11-15)

### Bug Fixes

* **rate-limit:** check job is active before moving to wait ([9502167](https://github.com/taskforcesh/bullmq/commit/9502167bb0d9008fc8811ff7980dc8126fbc5ac2)) ([`4226070`](https://github.com/taskforcesh/bullmq/commit/4226070d9905fb052a2ec00f17ee4210bf931fbd))

* chore(moveLimitedBackToWait): make sure delay is an int ([`2a76ee2`](https://github.com/taskforcesh/bullmq/commit/2a76ee24a3b989685c78393d43fa43afc6eb3c2b))

### Fix

* fix(rate-limit): check job is active before moving to wait ([`9502167`](https://github.com/taskforcesh/bullmq/commit/9502167bb0d9008fc8811ff7980dc8126fbc5ac2))


## v3.2.1 (2022-11-15)

### Chore

* chore(release): 3.2.1 [skip ci]

## [3.2.1](https://github.com/taskforcesh/bullmq/compare/v3.2.0...v3.2.1) (2022-11-15)

### Bug Fixes

* **worker:** consider removed jobs in failed event ([#1500](https://github.com/taskforcesh/bullmq/issues/1500)) ([8704b9a](https://github.com/taskforcesh/bullmq/commit/8704b9a10575fd7df738296f7156057123592b86)) ([`0301a7a`](https://github.com/taskforcesh/bullmq/commit/0301a7ab2b110670804de0dae63a04c7a314ee5a))

### Documentation

* docs: add nocodedb as usedBy ([`7a8754f`](https://github.com/taskforcesh/bullmq/commit/7a8754fdf2138418283f2b991334f2076440e7ee))

### Fix

* fix(worker): consider removed jobs in failed event (#1500) ([`8704b9a`](https://github.com/taskforcesh/bullmq/commit/8704b9a10575fd7df738296f7156057123592b86))

### Unknown

* GitBook: [#129] clarify flow architecture for waiting-children state ([`75f04d7`](https://github.com/taskforcesh/bullmq/commit/75f04d7e0480997210ee442ebd4157553112aeca))

* GitBook: [#128] update architecture images ([`f890565`](https://github.com/taskforcesh/bullmq/commit/f890565d90948bed9d27e955cfba8acda18a696e))


## v3.2.0 (2022-11-09)

### Chore

* chore(release): 3.2.0 [skip ci]

# [3.2.0](https://github.com/taskforcesh/bullmq/compare/v3.1.3...v3.2.0) (2022-11-09)

### Features

* **flow:** move parent to delayed when delay option is provided ([#1501](https://github.com/taskforcesh/bullmq/issues/1501)) ([2f3e5d5](https://github.com/taskforcesh/bullmq/commit/2f3e5d54f0797bf0d1adf14dbb2b51ad9f9183ca)) ([`f05e098`](https://github.com/taskforcesh/bullmq/commit/f05e098a6dad2038c720d77d71a66b387b53bcb1))

* chore(move-to-finished): remove debug statement (#1524) ([`65189dc`](https://github.com/taskforcesh/bullmq/commit/65189dc45b9f96d8b56cf44a5e6debaa4344a746))

### Documentation

* docs: update bullmq-pro changelog to 4.0.2 version ([`6892f3e`](https://github.com/taskforcesh/bullmq/commit/6892f3ef023b7c30150dd2192700d582f20feef2))

* docs(base-job-options): fix grammar

Change grammar &#34;an number&#34; should be &#34;a number&#34; ([`3451b59`](https://github.com/taskforcesh/bullmq/commit/3451b591a2158b6e2ae57a369389e23f4d4376e7))

### Feature

* feat(flow): move parent to delayed when delay option is provided (#1501) ([`2f3e5d5`](https://github.com/taskforcesh/bullmq/commit/2f3e5d54f0797bf0d1adf14dbb2b51ad9f9183ca))


## v3.1.3 (2022-11-04)

### Chore

* chore(release): 3.1.3 [skip ci]

## [3.1.3](https://github.com/taskforcesh/bullmq/compare/v3.1.2...v3.1.3) (2022-11-04)

### Bug Fixes

* **delayed:** better handling of marker id ([816376e](https://github.com/taskforcesh/bullmq/commit/816376e7880ae0eafe85a1f9a5aef9fdfe3031a9))
* **delayed:** notify workers a delayed job is closer in time fixes [#1505](https://github.com/taskforcesh/bullmq/issues/1505) ([6ced4d0](https://github.com/taskforcesh/bullmq/commit/6ced4d06c5c9c8342c9e4f7920a21826871eac1b))
* **job:** better error message in moveToFailed ([4e9f5bb](https://github.com/taskforcesh/bullmq/commit/4e9f5bb90f87c66eca959ffc9b7a09e05908c2d9))
* **moveToFinish:** always promote delayed jobs ([7610cc3](https://github.com/taskforcesh/bullmq/commit/7610cc37d4695a885043c251990e153d4ce4440f))
* **moveToFinished:** revert move promoteDelayedJobs ([7d780db](https://github.com/taskforcesh/bullmq/commit/7d780dbc1d7728ab7b762a5578871b31f27ff80c)) ([`f87858c`](https://github.com/taskforcesh/bullmq/commit/f87858caa382b56e34cc8015ad1a2706f2bcda8e))

### Fix

* fix(job): better error message in moveToFailed ([`4e9f5bb`](https://github.com/taskforcesh/bullmq/commit/4e9f5bb90f87c66eca959ffc9b7a09e05908c2d9))

* fix(delayed): better handling of marker id ([`816376e`](https://github.com/taskforcesh/bullmq/commit/816376e7880ae0eafe85a1f9a5aef9fdfe3031a9))

* fix(moveToFinished): revert move promoteDelayedJobs ([`7d780db`](https://github.com/taskforcesh/bullmq/commit/7d780dbc1d7728ab7b762a5578871b31f27ff80c))

* fix(moveToFinish): always promote delayed jobs ([`7610cc3`](https://github.com/taskforcesh/bullmq/commit/7610cc37d4695a885043c251990e153d4ce4440f))

* fix(delayed): notify workers a delayed job is closer in time fixes #1505 ([`6ced4d0`](https://github.com/taskforcesh/bullmq/commit/6ced4d06c5c9c8342c9e4f7920a21826871eac1b))


## v3.1.2 (2022-11-04)

### Chore

* chore(release): 3.1.2 [skip ci]

## [3.1.2](https://github.com/taskforcesh/bullmq/compare/v3.1.1...v3.1.2) (2022-11-04)

### Bug Fixes

* **repeat:** allow easy migration from bullmq &lt;3 to &gt;=3 ([e17b886](https://github.com/taskforcesh/bullmq/commit/e17b886d3e2978e25f23f1a99b88562537a08576)) ([`be39c09`](https://github.com/taskforcesh/bullmq/commit/be39c090684ccf720bcc6adc3279d7bb1d0a5ed5))

### Fix

* fix(repeat): allow easy migration from bullmq &lt;3 to &gt;=3 ([`e17b886`](https://github.com/taskforcesh/bullmq/commit/e17b886d3e2978e25f23f1a99b88562537a08576))


## v3.1.1 (2022-11-03)

### Chore

* chore(release): 3.1.1 [skip ci]

## [3.1.1](https://github.com/taskforcesh/bullmq/compare/v3.1.0...v3.1.1) (2022-11-03)

### Bug Fixes

* **change-delay:** remove delayed stream ([#1509](https://github.com/taskforcesh/bullmq/issues/1509)) ([6e4809e](https://github.com/taskforcesh/bullmq/commit/6e4809e5d8f7ef35bc0871d21bfcdcb0f1f316c6))
* **worker:** restore dynamic concurrency change ([#1515](https://github.com/taskforcesh/bullmq/issues/1515)) ([fdac5c2](https://github.com/taskforcesh/bullmq/commit/fdac5c27607dfaaaad1c1256c47f2ae448efcd21)) ([`ad70396`](https://github.com/taskforcesh/bullmq/commit/ad7039625d3adb334f07bb015068d57982252615))

* chore(deps): update github/codeql-action digest to 18fe527 (#1499) ([`fca6640`](https://github.com/taskforcesh/bullmq/commit/fca66406f1890a268f1948b457eb4b9dbdc1f393))

### Fix

* fix(change-delay): remove delayed stream (#1509) ([`6e4809e`](https://github.com/taskforcesh/bullmq/commit/6e4809e5d8f7ef35bc0871d21bfcdcb0f1f316c6))

* fix(worker): restore dynamic concurrency change (#1515) ([`fdac5c2`](https://github.com/taskforcesh/bullmq/commit/fdac5c27607dfaaaad1c1256c47f2ae448efcd21))


## v3.1.0 (2022-11-02)

### Chore

* chore(release): 3.1.0 [skip ci]

# [3.1.0](https://github.com/taskforcesh/bullmq/compare/v3.0.1...v3.1.0) (2022-11-02)

### Features

* **workers:** better error message for missing lock ([bf1d086](https://github.com/taskforcesh/bullmq/commit/bf1d0860c70bcc2b604d02ca47e5db64f962d71d)) ([`94c4862`](https://github.com/taskforcesh/bullmq/commit/94c4862fcb8de9676df20d3b002f8f13fddf658a))

### Feature

* feat(workers): better error message for missing lock ([`bf1d086`](https://github.com/taskforcesh/bullmq/commit/bf1d0860c70bcc2b604d02ca47e5db64f962d71d))


## v3.0.1 (2022-11-02)

### Chore

* chore(release): 3.0.1 [skip ci]

## [3.0.1](https://github.com/taskforcesh/bullmq/compare/v3.0.0...v3.0.1) (2022-11-02)

### Bug Fixes

* **move-to-delayed:** consider promoting delayed jobs ([#1493](https://github.com/taskforcesh/bullmq/issues/1493)) ([909da2b](https://github.com/taskforcesh/bullmq/commit/909da2bc2718a588379b3fdd9791bc8e51ad1dad))
* **retry-job:** consider promoting delayed jobs ([#1508](https://github.com/taskforcesh/bullmq/issues/1508)) ([d0b3412](https://github.com/taskforcesh/bullmq/commit/d0b3412d222449c24ab36068a791d08ea19ed922)) ([`c3c565d`](https://github.com/taskforcesh/bullmq/commit/c3c565dad2d7267e3bb1aa2a4d540f0c826def1a))

* chore(release): upgrade ubuntu version to latest ([`f2cb153`](https://github.com/taskforcesh/bullmq/commit/f2cb153abb4ba8f872efac56f1f514a3129b1cc7))

* chore(deps): update actions/setup-node digest to 8c91899 (#1473) ([`89bad09`](https://github.com/taskforcesh/bullmq/commit/89bad097edf1692dba19eec938da82b6f2be7430))

### Documentation

* docs: update bullmq-pro changelog ([`e023112`](https://github.com/taskforcesh/bullmq/commit/e02311294b850f8dcf817a1bb479a52d72b58db5))

* docs(rate-limiting): update group keys information ([`a1ee543`](https://github.com/taskforcesh/bullmq/commit/a1ee543d6c07cd70a2f03cca1b682ac945be8e35))

* docs(retrying-failing-jobs): update backoffStrategy examples ([`125ca2f`](https://github.com/taskforcesh/bullmq/commit/125ca2f58d48177168a75d4625aea4582b8d6f6d))

* docs: update README ([`32ace36`](https://github.com/taskforcesh/bullmq/commit/32ace362d9687ce16d86fc72bf4990205fd3a076))

### Fix

* fix(retry-job): consider promoting delayed jobs (#1508) ([`d0b3412`](https://github.com/taskforcesh/bullmq/commit/d0b3412d222449c24ab36068a791d08ea19ed922))

* fix(move-to-delayed): consider promoting delayed jobs (#1493) ([`909da2b`](https://github.com/taskforcesh/bullmq/commit/909da2bc2718a588379b3fdd9791bc8e51ad1dad))


## v3.0.0 (2022-10-25)

### Breaking

* feat(rate-limit): remove group key support and improve global rate limit

BREAKING CHANGE: limit by group keys has been removed in favor
of a much simpler and efficent rate-limit implementation. ([`81f780a`](https://github.com/taskforcesh/bullmq/commit/81f780aeed81e670107d01d01265d407a30e2a62))

* fix(backoff): handle backoff strategy as function (#1463)

BREAKING CHANGE: object mapping is replaced by single function ([`3640269`](https://github.com/taskforcesh/bullmq/commit/36402691a3c7fa500f07e2e11a28318099bdb909))

### Chore

* chore(release): 3.0.0 [skip ci]

# [3.0.0](https://github.com/taskforcesh/bullmq/compare/v2.4.0...v3.0.0) (2022-10-25)

### Bug Fixes

* **backoff:** handle backoff strategy as function ([#1463](https://github.com/taskforcesh/bullmq/issues/1463)) ([3640269](https://github.com/taskforcesh/bullmq/commit/36402691a3c7fa500f07e2e11a28318099bdb909))
* **repeat:** remove cron in favor of pattern option ([#1456](https://github.com/taskforcesh/bullmq/issues/1456)) ([3cc150e](https://github.com/taskforcesh/bullmq/commit/3cc150e32cb5971ad4ba6ff91246aaf75296c165))

### Features

* add support for dynamic rate limiting ([2d51d2b](https://github.com/taskforcesh/bullmq/commit/2d51d2b33ef49059503e1bca7a582c71f6861ef4))
* **rate-limit:** remove group key support and improve global rate limit ([81f780a](https://github.com/taskforcesh/bullmq/commit/81f780aeed81e670107d01d01265d407a30e2a62))

### BREAKING CHANGES

* **rate-limit:** limit by group keys has been removed in favor
of a much simpler and efficent rate-limit implementation.
* **backoff:** object mapping is replaced by single function ([`a252282`](https://github.com/taskforcesh/bullmq/commit/a2522822210d200ff66576d3a71bf3cc7c1a7622))

### Feature

* feat: add support for dynamic rate limiting ([`2d51d2b`](https://github.com/taskforcesh/bullmq/commit/2d51d2b33ef49059503e1bca7a582c71f6861ef4))

### Fix

* fix(repeat): remove cron in favor of pattern option (#1456) ([`3cc150e`](https://github.com/taskforcesh/bullmq/commit/3cc150e32cb5971ad4ba6ff91246aaf75296c165))

### Test

* test: add a bit of extra margin to rate-limit test ([`4f03545`](https://github.com/taskforcesh/bullmq/commit/4f035451aaaa1cbcec7e45b2b9a788383d889c40))

* test: remove irrelevant tests ([`285f1ba`](https://github.com/taskforcesh/bullmq/commit/285f1ba23ff17a2bfc01eb629d3f34c67700ee14))

### Unknown

* GitBook: [#126] No subject ([`c04ea4d`](https://github.com/taskforcesh/bullmq/commit/c04ea4da3b233e71bbb019f5398b6a542167ee83))


## v2.4.0 (2022-10-24)

### Chore

* chore(release): 2.4.0 [skip ci]

# [2.4.0](https://github.com/taskforcesh/bullmq/compare/v2.3.2...v2.4.0) (2022-10-24)

### Features

* **flows:** allow parent on root jobs in addBulk method ([#1488](https://github.com/taskforcesh/bullmq/issues/1488)) ref [#1480](https://github.com/taskforcesh/bullmq/issues/1480) ([92308e5](https://github.com/taskforcesh/bullmq/commit/92308e53acf14e0ce108d94ecd616633ac93e35d)) ([`65ce37a`](https://github.com/taskforcesh/bullmq/commit/65ce37ac10648e48e55a102eb0f59fce104fbcb9))

* chore(deps): update peaceiris/actions-gh-pages digest to de7ea6f (#1490) ([`6191040`](https://github.com/taskforcesh/bullmq/commit/61910409b9c9250cd371e805ead7f876127744a9))

* chore(deps): update github/codeql-action digest to cc7986c (#1482) ([`14ed954`](https://github.com/taskforcesh/bullmq/commit/14ed9545418b23a82921f98f94facd78b56f588c))

* chore(deps): lock file maintenance ([`3b983f9`](https://github.com/taskforcesh/bullmq/commit/3b983f955248ec0bceef8f919b9a2ecc6ec6ccd2))

### Documentation

* docs: update bullmq-pro changelog ([`94f020d`](https://github.com/taskforcesh/bullmq/commit/94f020d9617426c942582bf9c48b29c6ce0e38b9))

### Feature

* feat(flows): allow parent on root jobs in addBulk method (#1488) ref #1480 ([`92308e5`](https://github.com/taskforcesh/bullmq/commit/92308e53acf14e0ce108d94ecd616633ac93e35d))

### Refactor

* refactor(promote): reuse addJobWithPriority include (#1485) ([`899d3d0`](https://github.com/taskforcesh/bullmq/commit/899d3d05f5369d40d7ff22165c05fee412678a7a))


## v2.3.2 (2022-10-18)

### Chore

* chore(release): 2.3.2 [skip ci]

## [2.3.2](https://github.com/taskforcesh/bullmq/compare/v2.3.1...v2.3.2) (2022-10-18)

### Bug Fixes

* **job:** send failed event when failParentOnFailure ([#1481](https://github.com/taskforcesh/bullmq/issues/1481)) fixes [#1469](https://github.com/taskforcesh/bullmq/issues/1469) ([b20eb6f](https://github.com/taskforcesh/bullmq/commit/b20eb6f65c7e2c4593d5f9f4d4b940f780bf26d2)) ([`583bde4`](https://github.com/taskforcesh/bullmq/commit/583bde47ff0fa9366db968eca35e30b2fe89f4ad))

### Ci

* ci(build): copy lua scripts (#1476) ([`b96991e`](https://github.com/taskforcesh/bullmq/commit/b96991e0828cceb062b40f4e68625d422d84e146))

### Fix

* fix(job): send failed event when failParentOnFailure (#1481) fixes #1469 ([`b20eb6f`](https://github.com/taskforcesh/bullmq/commit/b20eb6f65c7e2c4593d5f9f4d4b940f780bf26d2))


## v2.3.1 (2022-10-13)

### Chore

* chore(release): 2.3.1 [skip ci]

## [2.3.1](https://github.com/taskforcesh/bullmq/compare/v2.3.0...v2.3.1) (2022-10-13)

### Bug Fixes

* **redis:** replace throw exception by console.error ([fafa2f8](https://github.com/taskforcesh/bullmq/commit/fafa2f89e796796f950e6c4abbdda4d3d71ad1b0)) ([`0fb2964`](https://github.com/taskforcesh/bullmq/commit/0fb2964151166f2aece0270c54c8cb4f4e2eb898))

### Fix

* fix(redis): replace throw exception by console.error ([`fafa2f8`](https://github.com/taskforcesh/bullmq/commit/fafa2f89e796796f950e6c4abbdda4d3d71ad1b0))


## v2.3.0 (2022-10-13)

### Chore

* chore(release): 2.3.0 [skip ci]

# [2.3.0](https://github.com/taskforcesh/bullmq/compare/v2.2.1...v2.3.0) (2022-10-13)

### Features

* **redis-connection:** allow providing scripts for extension ([#1472](https://github.com/taskforcesh/bullmq/issues/1472)) ([f193cfb](https://github.com/taskforcesh/bullmq/commit/f193cfb1830e127f9fd47a969baad30011a0e3a4)) ([`005539f`](https://github.com/taskforcesh/bullmq/commit/005539f2c34eff7ee92aeba1b34801fc69a05018))

* chore(deps): update actions/checkout digest to 93ea575 ([`4c88b2c`](https://github.com/taskforcesh/bullmq/commit/4c88b2ca4ff61db0dac4405267328a10d5ce9e69))

### Ci

* ci(docs): use pretest before docs script ([`2407bd9`](https://github.com/taskforcesh/bullmq/commit/2407bd9d4da03a414438dae285228635bf5cd681))

* ci(scripts): generate scripts before docs (#1470) ([`6947180`](https://github.com/taskforcesh/bullmq/commit/694718012788f1ddd207aa62d1e4dc857b716de2))

### Feature

* feat(redis-connection): allow providing scripts for extension (#1472) ([`f193cfb`](https://github.com/taskforcesh/bullmq/commit/f193cfb1830e127f9fd47a969baad30011a0e3a4))


## v2.2.1 (2022-10-11)

### Chore

* chore(release): 2.2.1 [skip ci]

## [2.2.1](https://github.com/taskforcesh/bullmq/compare/v2.2.0...v2.2.1) (2022-10-11)

### Performance Improvements

* **scripts:** pre-build scripts ([#1441](https://github.com/taskforcesh/bullmq/issues/1441)) ([7f72603](https://github.com/taskforcesh/bullmq/commit/7f72603d463f705d0617898cb221f832c49a4aa3)) ([`547a20f`](https://github.com/taskforcesh/bullmq/commit/547a20f652960472500940c71363fe65b111737e))

* chore(deps): lock file maintenance (#1457) ([`c2bdeef`](https://github.com/taskforcesh/bullmq/commit/c2bdeefab4a1cae920e38bed25dd47238e6163de))

### Performance

* perf(scripts): pre-build scripts (#1441) ([`7f72603`](https://github.com/taskforcesh/bullmq/commit/7f72603d463f705d0617898cb221f832c49a4aa3))


## v2.2.0 (2022-10-10)

### Chore

* chore(release): 2.2.0 [skip ci]

# [2.2.0](https://github.com/taskforcesh/bullmq/compare/v2.1.3...v2.2.0) (2022-10-10)

### Bug Fixes

* **connection:** validate array of strings in Cluster ([#1468](https://github.com/taskforcesh/bullmq/issues/1468)) fixes [#1467](https://github.com/taskforcesh/bullmq/issues/1467) ([8355182](https://github.com/taskforcesh/bullmq/commit/8355182a372b68ec62e9c3953bacbd69e0abfc74))

### Features

* **flow-producer:** allow parent opts in root job when adding a flow ([#1110](https://github.com/taskforcesh/bullmq/issues/1110)) ref [#1097](https://github.com/taskforcesh/bullmq/issues/1097) ([3c3ac71](https://github.com/taskforcesh/bullmq/commit/3c3ac718ad84f6bd0cc1575013c948e767b46f38)) ([`68f5b6f`](https://github.com/taskforcesh/bullmq/commit/68f5b6fedb1012926bd121df8ee62ddd32285b08))

* chore(deps): update github/codeql-action digest to 8075783 (#1465) ([`b85c24d`](https://github.com/taskforcesh/bullmq/commit/b85c24d95750e912a1c1a1e1826e8abb6ff49de8))

* chore(deps): update github/codeql-action digest to e0e5ded (#1398) ([`6ec5dab`](https://github.com/taskforcesh/bullmq/commit/6ec5dab961b25cc1103010004880a198cf240cb3))

### Documentation

* docs: fix Object.values usage in flows guide (#1466) ([`74cbcc2`](https://github.com/taskforcesh/bullmq/commit/74cbcc2514b18bb94e0067618ba7d83d57f00c87))

* docs(bullmq-pro): update changelog to version 2.4.12 ([`c4b9ee4`](https://github.com/taskforcesh/bullmq/commit/c4b9ee4961fd692741116727ffc03102c1f40afb))

### Feature

* feat(flow-producer): allow parent opts in root job when adding a flow (#1110) ref #1097 ([`3c3ac71`](https://github.com/taskforcesh/bullmq/commit/3c3ac718ad84f6bd0cc1575013c948e767b46f38))

### Fix

* fix(connection): validate array of strings in Cluster (#1468) fixes #1467 ([`8355182`](https://github.com/taskforcesh/bullmq/commit/8355182a372b68ec62e9c3953bacbd69e0abfc74))


## v2.1.3 (2022-09-30)

### Chore

* chore(release): 2.1.3 [skip ci]

## [2.1.3](https://github.com/taskforcesh/bullmq/compare/v2.1.2...v2.1.3) (2022-09-30)

### Bug Fixes

* **worker:** clear stalled jobs timer when closing worker ([1567a0d](https://github.com/taskforcesh/bullmq/commit/1567a0df0ca3c8d43a18990fe488888f4ff68040)) ([`ad3889c`](https://github.com/taskforcesh/bullmq/commit/ad3889c674da4eb8e772c47b7841d1c65fecb65e))

### Fix

* fix(worker): clear stalled jobs timer when closing worker ([`1567a0d`](https://github.com/taskforcesh/bullmq/commit/1567a0df0ca3c8d43a18990fe488888f4ff68040))


## v2.1.2 (2022-09-29)

### Chore

* chore(release): 2.1.2 [skip ci]

## [2.1.2](https://github.com/taskforcesh/bullmq/compare/v2.1.1...v2.1.2) (2022-09-29)

### Bug Fixes

* **getters:** fix return type of getJobLogs ([d452927](https://github.com/taskforcesh/bullmq/commit/d4529278c59b2c94eee604c7d4455acc490679e9)) ([`18d91d1`](https://github.com/taskforcesh/bullmq/commit/18d91d1786955bae0921577dbd93a2bdbe6e4e68))

* chore(deps): update actions/setup-node digest to 969bd26 ([`8016027`](https://github.com/taskforcesh/bullmq/commit/80160272df53a4e90b0a43a57865d94ec915a25d))

* chore(deps): lock file maintenance (#1445) ([`0cd64a6`](https://github.com/taskforcesh/bullmq/commit/0cd64a673679f7b532fb2adb85c0364713bc6908))

### Fix

* fix(getters): fix return type of getJobLogs ([`d452927`](https://github.com/taskforcesh/bullmq/commit/d4529278c59b2c94eee604c7d4455acc490679e9))


## v2.1.1 (2022-09-28)

### Chore

* chore(release): 2.1.1 [skip ci]

## [2.1.1](https://github.com/taskforcesh/bullmq/compare/v2.1.0...v2.1.1) (2022-09-28)

### Bug Fixes

* **sandbox:** get open port using built-in module instead of get-port ([#1446](https://github.com/taskforcesh/bullmq/issues/1446)) ([6db6288](https://github.com/taskforcesh/bullmq/commit/6db628868a9d64c5a3e47d1c9201017e6d05c1ae)) ([`4eb5a9a`](https://github.com/taskforcesh/bullmq/commit/4eb5a9a5c9cf9bf19de60cbef2ff90fde5a11a03))

### Documentation

* docs: update Queue Scheduler API Reference

The html page is no longer generated by typedoc since v2 ([`89bb53f`](https://github.com/taskforcesh/bullmq/commit/89bb53fb193e291f90b4be219507cdd7c7b04dba))

### Fix

* fix(sandbox): get open port using built-in module instead of get-port (#1446) ([`6db6288`](https://github.com/taskforcesh/bullmq/commit/6db628868a9d64c5a3e47d1c9201017e6d05c1ae))


## v2.1.0 (2022-09-23)

### Chore

* chore(release): 2.1.0 [skip ci]

# [2.1.0](https://github.com/taskforcesh/bullmq/compare/v2.0.2...v2.1.0) (2022-09-23)

### Features

* **job-options:** add failParentOnFailure option ([#1339](https://github.com/taskforcesh/bullmq/issues/1339)) ([65e5c36](https://github.com/taskforcesh/bullmq/commit/65e5c3678771f26555c9128bdb908dd62e3584f9)) ([`af1a066`](https://github.com/taskforcesh/bullmq/commit/af1a0664168a183250b56759cfb19b58be672b62))

### Documentation

* docs: fix typo on queue ([`4a977cb`](https://github.com/taskforcesh/bullmq/commit/4a977cba768fc2a36d9b34651bfa5e8eba336156))

### Feature

* feat(job-options): add failParentOnFailure option (#1339) ([`65e5c36`](https://github.com/taskforcesh/bullmq/commit/65e5c3678771f26555c9128bdb908dd62e3584f9))


## v2.0.2 (2022-09-22)

### Chore

* chore(release): 2.0.2 [skip ci]

## [2.0.2](https://github.com/taskforcesh/bullmq/compare/v2.0.1...v2.0.2) (2022-09-22)

### Bug Fixes

* **job:** update delay value when moving to wait ([#1436](https://github.com/taskforcesh/bullmq/issues/1436)) ([9560915](https://github.com/taskforcesh/bullmq/commit/95609158c1800cf661f22ad7995541fb9474826a)) ([`2eeb081`](https://github.com/taskforcesh/bullmq/commit/2eeb0812c007fd67adc6f54be7fe94d47ea06219))

### Fix

* fix(job): update delay value when moving to wait (#1436) ([`9560915`](https://github.com/taskforcesh/bullmq/commit/95609158c1800cf661f22ad7995541fb9474826a))

### Unknown

* GitBook: [#123] No subject ([`8fdb42d`](https://github.com/taskforcesh/bullmq/commit/8fdb42de089120c7daedbb16b2589b07f12baafe))


## v2.0.1 (2022-09-21)

### Chore

* chore(release): 2.0.1 [skip ci]

## [2.0.1](https://github.com/taskforcesh/bullmq/compare/v2.0.0...v2.0.1) (2022-09-21)

### Bug Fixes

* **connection:** throw error when no noeviction policy ([3468390](https://github.com/taskforcesh/bullmq/commit/3468390dd6331291f4cf71a54c32028a06d1d99e))

### Performance Improvements

* **events:** remove data and opts from added event ([e13d4b8](https://github.com/taskforcesh/bullmq/commit/e13d4b8e0c4f99203f4249ccc86e369d124ff483)) ([`0e26d88`](https://github.com/taskforcesh/bullmq/commit/0e26d88a6afee6becfa4f318a044f1177456b177))

### Documentation

* docs: manually updated changelog ([`00a3b48`](https://github.com/taskforcesh/bullmq/commit/00a3b48b6f7e71f337eb76aab856464c94f12fe7))

### Fix

* fix(connection): throw error when no noeviction policy ([`3468390`](https://github.com/taskforcesh/bullmq/commit/3468390dd6331291f4cf71a54c32028a06d1d99e))

### Performance

* perf(events): remove data and opts from added event ([`e13d4b8`](https://github.com/taskforcesh/bullmq/commit/e13d4b8e0c4f99203f4249ccc86e369d124ff483))


## v2.0.0 (2022-09-21)

### Breaking

* fix(compat): remove Queue3 class (#1421)

BREAKING CHANGE:
The compatibility class for Bullv3 is no longer available. ([`fc797f7`](https://github.com/taskforcesh/bullmq/commit/fc797f7cd334c19a95cb1290ddb6611cd3417179))

### Chore

* chore(release): 2.0.0 [skip ci]

# [2.0.0](https://github.com/taskforcesh/bullmq/compare/v1.91.1...v2.0.0) (2022-09-21)

### Bug Fixes

* **compat:** remove Queue3 class ([#1421](https://github.com/taskforcesh/bullmq/issues/1421)) ([fc797f7](https://github.com/taskforcesh/bullmq/commit/fc797f7cd334c19a95cb1290ddb6611cd3417179))
* **delayed:** promote delayed jobs instead of picking one by one ([1b938af](https://github.com/taskforcesh/bullmq/commit/1b938af75069d69772ddf2b03f95db7f53eada68))
* **getters:** compensate for &#34;mark&#34; job id ([231b9aa](https://github.com/taskforcesh/bullmq/commit/231b9aa0f4781e4493d3ea272c33b27c0b7dc0ab))
* **promote:** remove marker when promoting delayed job ([1aea0dc](https://github.com/taskforcesh/bullmq/commit/1aea0dcc5fb29086cef3d0c432c387d6f8261963))
* **sandbox:** remove progress method ([b43267b](https://github.com/taskforcesh/bullmq/commit/b43267be50f9eade8233500d189d46940a01cc29))
* **stalled-jobs:** handle job id 0 ([829e6e0](https://github.com/taskforcesh/bullmq/commit/829e6e0252e78bf2cbc55ab1d3bd153faa0cee4c))
* **worker:** do not allow stalledInterval to be less than zero ([831ffc5](https://github.com/taskforcesh/bullmq/commit/831ffc520ccd3c6ea63af6b04ddddc9f7829c667))
* **workers:** use connection closing to determine closing status ([fe1d173](https://github.com/taskforcesh/bullmq/commit/fe1d17321f1eb49bd872c52965392add22729941))

### Features

* improve delayed jobs and remove QueueScheduler ([1f66e5a](https://github.com/taskforcesh/bullmq/commit/1f66e5a6c891d52e0671e58a685dbca511e45e7e))
* move stalled jobs check and handling to Worker class from QueueScheduler ([13769cb](https://github.com/taskforcesh/bullmq/commit/13769cbe38ba22793cbc66e9706a6be28a7f1512))

### BREAKING CHANGES

* **compat:** The compatibility class for Bullv3 is no longer available.
* The QueueScheduler class is removed since it is not necessary anymore.
Delayed jobs are now handled in a much simpler and
robust way, without the need of a separate process.
* failed and stalled events are now produced by the Worker class instead of by the QueueScheduler. ([`5f3c316`](https://github.com/taskforcesh/bullmq/commit/5f3c31609b60589ed9e78317bf212dd407fad55b))

* chore: merge devel-2.0 ([`e20fc34`](https://github.com/taskforcesh/bullmq/commit/e20fc34e90589596c98b51a8ad774a733fe423bd))

* chore(deps): lock file maintenance ([`6f35126`](https://github.com/taskforcesh/bullmq/commit/6f35126bef0ac3021e95c66c27eb0bf6a0751f96))

* chore: add minimum recommended version 6.2.0 ([`9c3742a`](https://github.com/taskforcesh/bullmq/commit/9c3742ad003bcc5027f1ca0771b877ebc95e0200))

### Fix

* fix(sandbox): remove progress method ([`b43267b`](https://github.com/taskforcesh/bullmq/commit/b43267be50f9eade8233500d189d46940a01cc29))

* fix(stalled-jobs): handle job id 0 ([`829e6e0`](https://github.com/taskforcesh/bullmq/commit/829e6e0252e78bf2cbc55ab1d3bd153faa0cee4c))

* fix(delayed): promote delayed jobs instead of picking one by one ([`1b938af`](https://github.com/taskforcesh/bullmq/commit/1b938af75069d69772ddf2b03f95db7f53eada68))

### Unknown

* Merge pull request #1423 from taskforcesh/feat/removed-queue-scheduler

feat: eliminate the need of having a QueueScheduler ([`7b069ea`](https://github.com/taskforcesh/bullmq/commit/7b069ea9fbb5469c6f1e6ca2e339136170950e11))

* GitBook: [#122] No subject ([`f55e94c`](https://github.com/taskforcesh/bullmq/commit/f55e94c3887f5e1108aec5cbb6121d114ac63b46))


## v1.91.1 (2022-09-18)

### Chore

* chore(release): 1.91.1 [skip ci]

## [1.91.1](https://github.com/taskforcesh/bullmq/compare/v1.91.0...v1.91.1) (2022-09-18)

### Bug Fixes

* **drain:** consider empty active list ([#1412](https://github.com/taskforcesh/bullmq/issues/1412)) ([f919a50](https://github.com/taskforcesh/bullmq/commit/f919a50b2f4972dcb9ecd5848b0f7fd9a0e137ea)) ([`5f3338c`](https://github.com/taskforcesh/bullmq/commit/5f3338c1c125e08c3f2be86e51dc81ddce8daae5))

### Fix

* fix(drain): consider empty active list (#1412) ([`f919a50`](https://github.com/taskforcesh/bullmq/commit/f919a50b2f4972dcb9ecd5848b0f7fd9a0e137ea))

* fix(promote): remove marker when promoting delayed job ([`1aea0dc`](https://github.com/taskforcesh/bullmq/commit/1aea0dcc5fb29086cef3d0c432c387d6f8261963))

* fix(worker): do not allow stalledInterval to be less than zero ([`831ffc5`](https://github.com/taskforcesh/bullmq/commit/831ffc520ccd3c6ea63af6b04ddddc9f7829c667))

* fix(workers): use connection closing to determine closing status ([`fe1d173`](https://github.com/taskforcesh/bullmq/commit/fe1d17321f1eb49bd872c52965392add22729941))

* fix(getters): compensate for &#34;mark&#34; job id ([`231b9aa`](https://github.com/taskforcesh/bullmq/commit/231b9aa0f4781e4493d3ea272c33b27c0b7dc0ab))

### Test

* test(obliterate): make sure there are no active jobs when obliterating ([`4400b33`](https://github.com/taskforcesh/bullmq/commit/4400b33880835188f0805ab956a237945959dba8))

* test(job): skip delay priority test ([`dd304d3`](https://github.com/taskforcesh/bullmq/commit/dd304d3a0d63ec7bb4e3f40905b44f79f14b67bc))

* test(jobs): add an assertion ([`41343b4`](https://github.com/taskforcesh/bullmq/commit/41343b42a3ccbaeecf54585c03064f73b56df69f))

* test(clean): update some assertions ([`6b90d07`](https://github.com/taskforcesh/bullmq/commit/6b90d07e6803b0f2c5321e2677c96832cb7b237e))


## v1.91.0 (2022-09-16)

### Breaking

* feat: improve delayed jobs and remove QueueScheduler

BREAKING CHANGE:
The QueueScheduler class is removed since it is not necessary anymore.
Delayed jobs are now handled in a much simpler and
robust way, without the need of a separate process. ([`1f66e5a`](https://github.com/taskforcesh/bullmq/commit/1f66e5a6c891d52e0671e58a685dbca511e45e7e))

* feat: move stalled jobs check and handling to Worker class from QueueScheduler

BREAKING CHANGE:
failed and stalled events are now produced by the Worker class instead of by the QueueScheduler. ([`13769cb`](https://github.com/taskforcesh/bullmq/commit/13769cbe38ba22793cbc66e9706a6be28a7f1512))

### Chore

* chore(release): 1.91.0 [skip ci]

# [1.91.0](https://github.com/taskforcesh/bullmq/compare/v1.90.2...v1.91.0) (2022-09-16)

### Features

* **sandbox:** support update method ([#1416](https://github.com/taskforcesh/bullmq/issues/1416)) ([606b75d](https://github.com/taskforcesh/bullmq/commit/606b75d53e12dfc109f01eda38736c07e829e9b7)) ([`ca33621`](https://github.com/taskforcesh/bullmq/commit/ca336213a0fdba07d9abbdae7fa42bc4c52fa8a1))

* chore(deps): lock file maintenance ([`7904fb1`](https://github.com/taskforcesh/bullmq/commit/7904fb155406471511403abd2592362d1a176c26))

### Feature

* feat(sandbox): support update method (#1416) ([`606b75d`](https://github.com/taskforcesh/bullmq/commit/606b75d53e12dfc109f01eda38736c07e829e9b7))

### Test

* test(worker): fix test case ([`43c0e72`](https://github.com/taskforcesh/bullmq/commit/43c0e723c8497639e7855e1f3a61865096fc03d4))

### Unknown

* Merge branch &#39;feat/move-check-stalled-jobs-to-worker&#39; of github.com:taskforcesh/bullmq into feat/move-check-stalled-jobs-to-worker ([`67d7cd6`](https://github.com/taskforcesh/bullmq/commit/67d7cd683e8183bd9a42e5cdcfa152db9c40112c))


## v1.90.2 (2022-09-12)

### Chore

* chore(release): 1.90.2 [skip ci]

## [1.90.2](https://github.com/taskforcesh/bullmq/compare/v1.90.1...v1.90.2) (2022-09-12)

### Performance Improvements

* **script-loader:** use cache to read script once ([#1410](https://github.com/taskforcesh/bullmq/issues/1410)) ([f956e93](https://github.com/taskforcesh/bullmq/commit/f956e937ae3488cdcd0e2eacbe3e096c8066ebd1)) ([`31c3297`](https://github.com/taskforcesh/bullmq/commit/31c3297592cf4fb550007e06cf8da8f99a4a2580))

* chore(deps): update dependency uuid to v9 ([`ca29c1a`](https://github.com/taskforcesh/bullmq/commit/ca29c1a5bb4e31a48ff84258d94f07961bb1f9a8))

* chore(deps): lock file maintenance ([`9d71495`](https://github.com/taskforcesh/bullmq/commit/9d714950965dfdcefc147c81f84f9b52c4e206b7))

### Documentation

* docs: update RedisGreen sponsorship with new name ([`06be1eb`](https://github.com/taskforcesh/bullmq/commit/06be1ebab7c4e8e24cbe4508a6c3153a3e0edb21))

* docs(bullmq-pro): update changelog to version 2.4.7 ([`f7234a6`](https://github.com/taskforcesh/bullmq/commit/f7234a61ea8e8884ea90a044ba838fc7a99eb7ad))

### Performance

* perf(script-loader): use cache to read script once (#1410) ([`f956e93`](https://github.com/taskforcesh/bullmq/commit/f956e937ae3488cdcd0e2eacbe3e096c8066ebd1))

### Test

* test(rate-limit): split tests (#1400) ([`f2d00c3`](https://github.com/taskforcesh/bullmq/commit/f2d00c328ce0578dd5837fb37ce471d166d1e246))


## v1.90.1 (2022-09-02)

### Chore

* chore(release): 1.90.1 [skip ci]

## [1.90.1](https://github.com/taskforcesh/bullmq/compare/v1.90.0...v1.90.1) (2022-09-02)

### Performance Improvements

* **add-job:** handle parent split on js ([#1397](https://github.com/taskforcesh/bullmq/issues/1397)) ([566f074](https://github.com/taskforcesh/bullmq/commit/566f0747110679e5b07e7642fef793744565fffe)) ([`632d9b6`](https://github.com/taskforcesh/bullmq/commit/632d9b6b94b1d0fc6082d519defc70c8329c7f3f))

* chore(deps): lock file maintenance ([`45a8e4d`](https://github.com/taskforcesh/bullmq/commit/45a8e4dadbfc39ce387613e4fbce3867c8c80b95))

### Performance

* perf(add-job): handle parent split on js (#1397) ([`566f074`](https://github.com/taskforcesh/bullmq/commit/566f0747110679e5b07e7642fef793744565fffe))


## v1.90.0 (2022-08-30)

### Chore

* chore(release): 1.90.0 [skip ci]

# [1.90.0](https://github.com/taskforcesh/bullmq/compare/v1.89.2...v1.90.0) (2022-08-30)

### Features

* **repeat:** allow passing a cron strategy ([#1248](https://github.com/taskforcesh/bullmq/issues/1248)) ref [#1245](https://github.com/taskforcesh/bullmq/issues/1245) ([7f0534f](https://github.com/taskforcesh/bullmq/commit/7f0534f72449ae14a7415fa17a2eb2a70136a8b0)) ([`0a18c0f`](https://github.com/taskforcesh/bullmq/commit/0a18c0f2f4368c5a716b7147556f545e340f7c12))

* chore(deps): update github/codeql-action digest to c7f292e ([`1925925`](https://github.com/taskforcesh/bullmq/commit/192592565a6adf5da7513ade46ca210904f229c3))

### Documentation

* docs(bullmq-pro): update changelog to version 2.4.3 ([`0bf8428`](https://github.com/taskforcesh/bullmq/commit/0bf8428d9174ddcc861ae84f8a7b54df67a4d3ee))

### Feature

* feat(repeat): allow passing a cron strategy (#1248) ref #1245 ([`7f0534f`](https://github.com/taskforcesh/bullmq/commit/7f0534f72449ae14a7415fa17a2eb2a70136a8b0))


## v1.89.2 (2022-08-23)

### Chore

* chore(release): 1.89.2 [skip ci]

## [1.89.2](https://github.com/taskforcesh/bullmq/compare/v1.89.1...v1.89.2) (2022-08-23)

### Bug Fixes

* **job:** update delay when changeDelay ([#1389](https://github.com/taskforcesh/bullmq/issues/1389)) fixes [#1160](https://github.com/taskforcesh/bullmq/issues/1160) ([d9b100d](https://github.com/taskforcesh/bullmq/commit/d9b100d04112c518ef2efbcf5586aa1226ccccab)) ([`9d2355a`](https://github.com/taskforcesh/bullmq/commit/9d2355a8f30838d4638f75568f9bb879ce4aac6d))

### Fix

* fix(job): update delay when changeDelay (#1389) fixes #1160 ([`d9b100d`](https://github.com/taskforcesh/bullmq/commit/d9b100d04112c518ef2efbcf5586aa1226ccccab))

### Unknown

* GitBook: [#121] No subject ([`b9fd5bb`](https://github.com/taskforcesh/bullmq/commit/b9fd5bbb15706cc1fef6d9cb00c25581258a10dd))


## v1.89.1 (2022-08-19)

### Chore

* chore(release): 1.89.1 [skip ci]

## [1.89.1](https://github.com/taskforcesh/bullmq/compare/v1.89.0...v1.89.1) (2022-08-19)

### Bug Fixes

* revert &#34;chore: allow esm imports through exports field&#34; ([#1388](https://github.com/taskforcesh/bullmq/issues/1388)) ([8e51272](https://github.com/taskforcesh/bullmq/commit/8e512724b1e8145bceb0152b70a934decf6d6864)) ([`db9d1ad`](https://github.com/taskforcesh/bullmq/commit/db9d1ad98628c6023fa05f2f86c09a528405aee7))

### Fix

* fix: revert &#34;chore: allow esm imports through exports field&#34; (#1388) ([`8e51272`](https://github.com/taskforcesh/bullmq/commit/8e512724b1e8145bceb0152b70a934decf6d6864))


## v1.89.0 (2022-08-18)

### Chore

* chore(release): 1.89.0 [skip ci]

# [1.89.0](https://github.com/taskforcesh/bullmq/compare/v1.88.2...v1.89.0) (2022-08-18)

### Features

* **job:** expose delay in instance ([#1386](https://github.com/taskforcesh/bullmq/issues/1386)) ([d4d0d2e](https://github.com/taskforcesh/bullmq/commit/d4d0d2e737c7ceb5eb34a2c50d53bd1081e0ad4a)) ([`3ee4f5e`](https://github.com/taskforcesh/bullmq/commit/3ee4f5e0063077e40526b3d3315c2ca76e71657d))

### Feature

* feat(job): expose delay in instance (#1386) ([`d4d0d2e`](https://github.com/taskforcesh/bullmq/commit/d4d0d2e737c7ceb5eb34a2c50d53bd1081e0ad4a))


## v1.88.2 (2022-08-18)

### Chore

* chore(release): 1.88.2 [skip ci]

## [1.88.2](https://github.com/taskforcesh/bullmq/compare/v1.88.1...v1.88.2) (2022-08-18)

### Bug Fixes

* revert &#34;feat(sandbox): experimental support ESM&#34; ([#1384](https://github.com/taskforcesh/bullmq/issues/1384)) ([7d180eb](https://github.com/taskforcesh/bullmq/commit/7d180eb18daa41062dcbca72213bc9d9f40153db)) ([`77cfec5`](https://github.com/taskforcesh/bullmq/commit/77cfec58bc2096df7e945b9a811d1341a3f85d65))

### Fix

* fix: revert &#34;feat(sandbox): experimental support ESM&#34; (#1384)

This reverts commit ed0faff3c67c436116eb625ffacb03e435caee3f. ([`7d180eb`](https://github.com/taskforcesh/bullmq/commit/7d180eb18daa41062dcbca72213bc9d9f40153db))

### Style

* style: restore eslint deps (#1383) ([`5f813c3`](https://github.com/taskforcesh/bullmq/commit/5f813c32150122a596a0a44c527c26964189e0a0))


## v1.88.1 (2022-08-17)

### Chore

* chore(release): 1.88.1 [skip ci]

## [1.88.1](https://github.com/taskforcesh/bullmq/compare/v1.88.0...v1.88.1) (2022-08-17)

### Bug Fixes

* fix husky install ([edee918](https://github.com/taskforcesh/bullmq/commit/edee918e84ba895ed4ef63cabcc26b97d9c52d8d)) ([`d08566c`](https://github.com/taskforcesh/bullmq/commit/d08566c05dc6d036c689fd4164e15d20e1bfc74f))

### Fix

* fix: fix husky install ([`edee918`](https://github.com/taskforcesh/bullmq/commit/edee918e84ba895ed4ef63cabcc26b97d9c52d8d))


## v1.88.0 (2022-08-17)

### Chore

* chore(release): 1.88.0 [skip ci]

# [1.88.0](https://github.com/taskforcesh/bullmq/compare/v1.87.2...v1.88.0) (2022-08-17)

### Bug Fixes

* **clean:** consider priority when cleaning waiting jobs ([#1357](https://github.com/taskforcesh/bullmq/issues/1357)) ([ced5be1](https://github.com/taskforcesh/bullmq/commit/ced5be1c9531953baa9cf87d6bda3faa5863270d))
* **parent-priority-check:** use tonumber on priority ([#1370](https://github.com/taskforcesh/bullmq/issues/1370)) ([e2043c6](https://github.com/taskforcesh/bullmq/commit/e2043c6f4b8ad5faea8c13edde76aea60612fec6))

### Features

* **sandbox:** experimental support ESM ([ed0faff](https://github.com/taskforcesh/bullmq/commit/ed0faff3c67c436116eb625ffacb03e435caee3f)) ([`e30b0c9`](https://github.com/taskforcesh/bullmq/commit/e30b0c974d2fc2eedeb434afaf17a80cc2eab5bf))

* chore: disable husky in semantic release (#1377) ([`c3cbea5`](https://github.com/taskforcesh/bullmq/commit/c3cbea554a2b507a1551ed960c16568d14cc1642))

* chore: upgrade get-port without deprecating node12 (#1374) ([`c9bd025`](https://github.com/taskforcesh/bullmq/commit/c9bd02540e4577b39f819673b80d82a0bd854894))

* chore(compat): use some unused types properly (#1360) ([`1916516`](https://github.com/taskforcesh/bullmq/commit/19165160c6184757fb160aac38bb6f22c80188f8))

* chore: allow esm imports through exports field ([`f7ae7c0`](https://github.com/taskforcesh/bullmq/commit/f7ae7c0c87bb1eeb7ef897bc77606ddfa667d688))

* chore(deps): update dependency tslib to v2 ([`889d7f5`](https://github.com/taskforcesh/bullmq/commit/889d7f5b9c87414ac2f3c898c5014dc192dee44c))

* chore(deps): add renovate.json ([`d8c3b0a`](https://github.com/taskforcesh/bullmq/commit/d8c3b0abe04248721c64c5dc3f4b26c47826db9f))

* chore: adapt to ioredis 5 ([`1b6cf41`](https://github.com/taskforcesh/bullmq/commit/1b6cf41395e9c2515d044363f9d976d8bdfd0ccc))

* chore: update dependencies ([`8063a78`](https://github.com/taskforcesh/bullmq/commit/8063a782d60a6daa326233f54d50ef587148652c))

* chore: streamline ci setup ([`3b060fa`](https://github.com/taskforcesh/bullmq/commit/3b060fa6daf803ee3a7510a4759693121a0d184e))

### Ci

* ci: set up nyc coverage limits aligned with reality ([`a22430b`](https://github.com/taskforcesh/bullmq/commit/a22430b5c29ac6a87a889022285ee34f93a56f9e))

### Feature

* feat(sandbox): experimental support ESM ([`ed0faff`](https://github.com/taskforcesh/bullmq/commit/ed0faff3c67c436116eb625ffacb03e435caee3f))

### Fix

* fix(clean): consider priority when cleaning waiting jobs (#1357) ([`ced5be1`](https://github.com/taskforcesh/bullmq/commit/ced5be1c9531953baa9cf87d6bda3faa5863270d))

* fix(parent-priority-check): use tonumber on priority (#1370) ([`e2043c6`](https://github.com/taskforcesh/bullmq/commit/e2043c6f4b8ad5faea8c13edde76aea60612fec6))


## v1.87.2 (2022-08-13)

### Chore

* chore(release): 1.87.2 [skip ci]

## [1.87.2](https://github.com/taskforcesh/bullmq/compare/v1.87.1...v1.87.2) (2022-08-13)

### Bug Fixes

* **move-parent-to-wait:** emit waiting instead of active event ([#1356](https://github.com/taskforcesh/bullmq/issues/1356)) ([53578dd](https://github.com/taskforcesh/bullmq/commit/53578dd1cbe31b49361a833b1aca449486f3b925)) ([`19c0da8`](https://github.com/taskforcesh/bullmq/commit/19c0da8aa7cd2fe891364dc0cf1b6b26bd77adee))

### Fix

* fix(move-parent-to-wait): emit waiting instead of active event (#1356) ([`53578dd`](https://github.com/taskforcesh/bullmq/commit/53578dd1cbe31b49361a833b1aca449486f3b925))


## v1.87.1 (2022-08-09)

### Chore

* chore(release): 1.87.1 [skip ci]

## [1.87.1](https://github.com/taskforcesh/bullmq/compare/v1.87.0...v1.87.1) (2022-08-09)

### Bug Fixes

* **job:** declare discarded as protected ([#1352](https://github.com/taskforcesh/bullmq/issues/1352)) ([870e01c](https://github.com/taskforcesh/bullmq/commit/870e01c4ab602c1e6e351cc369f3eac5f7afa083)) ([`380c56e`](https://github.com/taskforcesh/bullmq/commit/380c56e43bf59895ffc2ca0ed5a2ade79803a872))

### Documentation

* docs(bullmq-pro): update changelog to version 2.3.10 ([`1d9dd6e`](https://github.com/taskforcesh/bullmq/commit/1d9dd6eb812cea211b17785f437ef07a78e90166))

### Fix

* fix(job): declare discarded as protected (#1352) ([`870e01c`](https://github.com/taskforcesh/bullmq/commit/870e01c4ab602c1e6e351cc369f3eac5f7afa083))


## v1.87.0 (2022-08-05)

### Chore

* chore(release): 1.87.0 [skip ci]

# [1.87.0](https://github.com/taskforcesh/bullmq/compare/v1.86.10...v1.87.0) (2022-08-05)

### Features

* **flow:** consider priority when parent is moved ([#1286](https://github.com/taskforcesh/bullmq/issues/1286)) ([d49760d](https://github.com/taskforcesh/bullmq/commit/d49760d09420c5fcc99ab06c8fe36168755fd397)) ([`d19a712`](https://github.com/taskforcesh/bullmq/commit/d19a71229b6ddaf8b44b9ad41152f052ff1aeadd))

* chore(scripts): generate raw scripts (#1209) ([`d07deb1`](https://github.com/taskforcesh/bullmq/commit/d07deb1cb16180fea6a31922a92c658dc5ebb868))

### Documentation

* docs(bullmq-pro): update changelog to version 2.3.9 ([`64ccdde`](https://github.com/taskforcesh/bullmq/commit/64ccdde2179d8709107f982ea6506804abbfd6f7))

### Feature

* feat(flow): consider priority when parent is moved (#1286) ([`d49760d`](https://github.com/taskforcesh/bullmq/commit/d49760d09420c5fcc99ab06c8fe36168755fd397))

### Unknown

* GitBook: [#120] No subject ([`7ca048a`](https://github.com/taskforcesh/bullmq/commit/7ca048a6b90a0bb13a7f404ff9e8afb8315b22ed))

* GitBook: [#119] No subject ([`168f1da`](https://github.com/taskforcesh/bullmq/commit/168f1da199841f50bf4943a3fadfc22db1214f33))

* GitBook: [#118] No subject ([`94071e8`](https://github.com/taskforcesh/bullmq/commit/94071e806c3d36c2da44214d0f04912001369b6a))


## v1.86.10 (2022-07-29)

### Chore

* chore(release): 1.86.10 [skip ci]

## [1.86.10](https://github.com/taskforcesh/bullmq/compare/v1.86.9...v1.86.10) (2022-07-29)

### Performance Improvements

* **clean-jobs-in-set:** use ZRANGEBYSCORE when limit &gt; 0 ([#1338](https://github.com/taskforcesh/bullmq/issues/1338)) ([f0d9985](https://github.com/taskforcesh/bullmq/commit/f0d998541f03778ca2a092080a19e6bf7b7d0af1)) ([`7251dd7`](https://github.com/taskforcesh/bullmq/commit/7251dd7259ab0d2e1c6343e3fc491ad41195816f))

### Performance

* perf(clean-jobs-in-set): use ZRANGEBYSCORE when limit &gt; 0 (#1338) ([`f0d9985`](https://github.com/taskforcesh/bullmq/commit/f0d998541f03778ca2a092080a19e6bf7b7d0af1))


## v1.86.9 (2022-07-27)

### Chore

* chore(release): 1.86.9 [skip ci]

## [1.86.9](https://github.com/taskforcesh/bullmq/compare/v1.86.8...v1.86.9) (2022-07-27)

### Bug Fixes

* **get-flow:** consider groupKey ([#1336](https://github.com/taskforcesh/bullmq/issues/1336)) fixes [#1334](https://github.com/taskforcesh/bullmq/issues/1334) ([9f31272](https://github.com/taskforcesh/bullmq/commit/9f31272fa8b3f5b8ab26f15e21bd80537c5baef0)) ([`9c14458`](https://github.com/taskforcesh/bullmq/commit/9c14458ca130171c38af82d2d0bd51b8779f21cc))

### Fix

* fix(get-flow): consider groupKey (#1336) fixes #1334 ([`9f31272`](https://github.com/taskforcesh/bullmq/commit/9f31272fa8b3f5b8ab26f15e21bd80537c5baef0))


## v1.86.8 (2022-07-26)

### Chore

* chore(release): 1.86.8 [skip ci]

## [1.86.8](https://github.com/taskforcesh/bullmq/compare/v1.86.7...v1.86.8) (2022-07-26)

### Bug Fixes

* **promote:** consider empty queue when paused ([#1335](https://github.com/taskforcesh/bullmq/issues/1335)) ([9f742e8](https://github.com/taskforcesh/bullmq/commit/9f742e88d6338ce9ac7e0413bdac411ab6cf675c)) ([`19b34bd`](https://github.com/taskforcesh/bullmq/commit/19b34bd3005e0dc21a6a181ac6771142bf8454eb))

### Documentation

* docs(bullmq-pro): update changelog to version 2.3.5 ([`788faef`](https://github.com/taskforcesh/bullmq/commit/788faefbb0240964cedb35daadf296d258417965))

* docs(readme): fix incorrect typescript example (#1329) ([`4646f3b`](https://github.com/taskforcesh/bullmq/commit/4646f3b292788e824b15b1cb670fee9a341e6d24))

### Fix

* fix(promote): consider empty queue when paused (#1335) ([`9f742e8`](https://github.com/taskforcesh/bullmq/commit/9f742e88d6338ce9ac7e0413bdac411ab6cf675c))

### Refactor

* refactor(job): replace slow object destructuring with single object in getDependencies (#1324) fixes #1323 ([`ec8afcc`](https://github.com/taskforcesh/bullmq/commit/ec8afcc54a7fc6feeb9fcd124b5c69392909b8d3))

### Unknown

* GitBook: [#117] No subject ([`cbe57d2`](https://github.com/taskforcesh/bullmq/commit/cbe57d29043acebf150525f5c4110eb12bde8de1))


## v1.86.7 (2022-07-15)

### Chore

* chore(release): 1.86.7 [skip ci]

## [1.86.7](https://github.com/taskforcesh/bullmq/compare/v1.86.6...v1.86.7) (2022-07-15)

### Bug Fixes

* **sandboxed-process:** consider UnrecoverableError ([#1320](https://github.com/taskforcesh/bullmq/issues/1320)) fixes [#1317](https://github.com/taskforcesh/bullmq/issues/1317) ([c1269cc](https://github.com/taskforcesh/bullmq/commit/c1269cc772c6cec84d82ff790b9a7c9cc4242dcb)) ([`306543a`](https://github.com/taskforcesh/bullmq/commit/306543a7e055c22faa6c34c1bb7190060691458f))

### Fix

* fix(sandboxed-process): consider UnrecoverableError (#1320) fixes #1317 ([`c1269cc`](https://github.com/taskforcesh/bullmq/commit/c1269cc772c6cec84d82ff790b9a7c9cc4242dcb))


## v1.86.6 (2022-07-14)

### Chore

* chore(release): 1.86.6 [skip ci]

## [1.86.6](https://github.com/taskforcesh/bullmq/compare/v1.86.5...v1.86.6) (2022-07-14)

### Bug Fixes

* **retry-jobs:** consider paused queue ([#1321](https://github.com/taskforcesh/bullmq/issues/1321)) ([3e9703d](https://github.com/taskforcesh/bullmq/commit/3e9703d17fc9dc601d5d77e999f3e9a137f20843)) ([`970bb87`](https://github.com/taskforcesh/bullmq/commit/970bb87eff67fce0fb4d37609182ad47d3e9309e))

* chore(deps-dev): bump moment from 2.29.2 to 2.29.4 (#1315) ([`e50bd88`](https://github.com/taskforcesh/bullmq/commit/e50bd884707777d60f039e223572cdfb8be11c0d))

### Documentation

* docs(bullmq-pro): update changelog ([`331f6fd`](https://github.com/taskforcesh/bullmq/commit/331f6fdae579e3f2810810d645ab61afdbe86272))

### Fix

* fix(retry-jobs): consider paused queue (#1321) ([`3e9703d`](https://github.com/taskforcesh/bullmq/commit/3e9703d17fc9dc601d5d77e999f3e9a137f20843))


## v1.86.5 (2022-07-09)

### Chore

* chore(release): 1.86.5 [skip ci]

## [1.86.5](https://github.com/taskforcesh/bullmq/compare/v1.86.4...v1.86.5) (2022-07-09)

### Bug Fixes

* **retry-job:** consider paused queue ([#1314](https://github.com/taskforcesh/bullmq/issues/1314)) ([907ae1d](https://github.com/taskforcesh/bullmq/commit/907ae1d7e3504f31c625ec8a09e32785f08357ff)) ([`4c182df`](https://github.com/taskforcesh/bullmq/commit/4c182df13c2223b2d6615506844999c474adf1bd))

### Documentation

* docs(bullmq-pro): update changelog ([`ff1f1ee`](https://github.com/taskforcesh/bullmq/commit/ff1f1ee5b5cdec0e9c669df99699cc4a4b9840e5))

* docs(bullmq-pro): update changelog ([`dba0b3b`](https://github.com/taskforcesh/bullmq/commit/dba0b3bd86850fe612f38c9a122cf9ccd8ab0194))

* docs: add new api references ([`bd64c46`](https://github.com/taskforcesh/bullmq/commit/bd64c4663ce956d24e4b2d37134416ba5f344899))

### Fix

* fix(retry-job): consider paused queue (#1314) ([`907ae1d`](https://github.com/taskforcesh/bullmq/commit/907ae1d7e3504f31c625ec8a09e32785f08357ff))

### Unknown

* GitBook: [#116] No subject ([`40ca91b`](https://github.com/taskforcesh/bullmq/commit/40ca91b823f4141de3ec59e44c821c4a5d2d1052))

* GitBook: [#114] No subject ([`29a1ba9`](https://github.com/taskforcesh/bullmq/commit/29a1ba95db0a2986468ebe8159a904b783bef8d8))


## v1.86.4 (2022-06-29)

### Chore

* chore(release): 1.86.4 [skip ci]

## [1.86.4](https://github.com/taskforcesh/bullmq/compare/v1.86.3...v1.86.4) (2022-06-29)

### Bug Fixes

* **parent:** emit waiting event when no pending children ([#1296](https://github.com/taskforcesh/bullmq/issues/1296)) ([aa8fa3f](https://github.com/taskforcesh/bullmq/commit/aa8fa3f8cd5ab6d7d309d87ae45c558249b1c29c)) ([`868bb00`](https://github.com/taskforcesh/bullmq/commit/868bb00213626fdfa3c8594c8f8dfea9b47cd7b1))

### Documentation

* docs: add Novu in &#34;used by&#34; ([`b1de9bc`](https://github.com/taskforcesh/bullmq/commit/b1de9bc3378f6d0ef9a8f3f4bd20ea2216b902a0))

* docs(pausing-groups): update description and bullmq-pro changelog ([`fdc894b`](https://github.com/taskforcesh/bullmq/commit/fdc894b4cc39705cb73409db8ea37328999d0302))

### Fix

* fix(parent): emit waiting event when no pending children (#1296) ([`aa8fa3f`](https://github.com/taskforcesh/bullmq/commit/aa8fa3f8cd5ab6d7d309d87ae45c558249b1c29c))


## v1.86.3 (2022-06-26)

### Chore

* chore(release): 1.86.3 [skip ci]

## [1.86.3](https://github.com/taskforcesh/bullmq/compare/v1.86.2...v1.86.3) (2022-06-26)

### Bug Fixes

* avoid calling delay() if queue is being closed ([#1295](https://github.com/taskforcesh/bullmq/issues/1295)) ([52a5045](https://github.com/taskforcesh/bullmq/commit/52a5045b903ed6e0e73dd747748787a6389f12f7)) ([`9dc1420`](https://github.com/taskforcesh/bullmq/commit/9dc1420f08e094df821085412e55a4e0dbac36ec))

### Documentation

* docs(bullmq-pro): add pausing-groups section ([`b7b8741`](https://github.com/taskforcesh/bullmq/commit/b7b874134e01d8d3ff5078823037d897d8a5d5a1))

### Fix

* fix: avoid calling delay() if queue is being closed (#1295) ([`52a5045`](https://github.com/taskforcesh/bullmq/commit/52a5045b903ed6e0e73dd747748787a6389f12f7))

### Unknown

* GitBook: [#113] No subject ([`5b1a71a`](https://github.com/taskforcesh/bullmq/commit/5b1a71a6200b4b5c8e42f9dd618441c223ffe834))

* GitBook: [#112] No subject ([`897c4b3`](https://github.com/taskforcesh/bullmq/commit/897c4b3451ba373409dcd3c96b84b3c3c59bbf17))


## v1.86.2 (2022-06-16)

### Chore

* chore(release): 1.86.2 [skip ci]

## [1.86.2](https://github.com/taskforcesh/bullmq/compare/v1.86.1...v1.86.2) (2022-06-16)

### Bug Fixes

* **queue:** get rid of repeat options from defaultJobOptions ([#1284](https://github.com/taskforcesh/bullmq/issues/1284)) ([cdd2a20](https://github.com/taskforcesh/bullmq/commit/cdd2a20c2c4ca47042ecd1da525ecb72941e4910)) ([`88095f6`](https://github.com/taskforcesh/bullmq/commit/88095f6261ca57cf13eba5582cb71d7b69ab2339))

### Fix

* fix(queue): get rid of repeat options from defaultJobOptions (#1284) ([`cdd2a20`](https://github.com/taskforcesh/bullmq/commit/cdd2a20c2c4ca47042ecd1da525ecb72941e4910))


## v1.86.1 (2022-06-12)

### Chore

* chore(release): 1.86.1 [skip ci]

## [1.86.1](https://github.com/taskforcesh/bullmq/compare/v1.86.0...v1.86.1) (2022-06-12)

### Bug Fixes

* unpack empty metrics in batches ([96829db](https://github.com/taskforcesh/bullmq/commit/96829db839fad4489415f7dbb047abdca5566e78)) ([`1769ce1`](https://github.com/taskforcesh/bullmq/commit/1769ce15d907269c34be1b26671ab5e71fae43d1))

### Fix

* fix: unpack empty metrics in batches ([`96829db`](https://github.com/taskforcesh/bullmq/commit/96829db839fad4489415f7dbb047abdca5566e78))


## v1.86.0 (2022-06-10)

### Chore

* chore(release): 1.86.0 [skip ci]

# [1.86.0](https://github.com/taskforcesh/bullmq/compare/v1.85.4...v1.86.0) (2022-06-10)

### Features

* **repeat:** save repeatJobKey reference ([#1214](https://github.com/taskforcesh/bullmq/issues/1214)) ([4d5a8e3](https://github.com/taskforcesh/bullmq/commit/4d5a8e33b614cf099369c18298e5b2963b434b1b)) ([`363f6c0`](https://github.com/taskforcesh/bullmq/commit/363f6c05f0ca64db9fc7a028b57b9a301a9a8808))

### Documentation

* docs: add some missing API documentation ([`8baaae6`](https://github.com/taskforcesh/bullmq/commit/8baaae6f3625ccb88d22e4bd1938447b8352d3f7))

* docs(bullmq-pro): add ttl per job name description (#1276) ([`2d59174`](https://github.com/taskforcesh/bullmq/commit/2d59174986c55fce334999fdb2905e06a948edb5))

### Feature

* feat(repeat): save repeatJobKey reference (#1214) ([`4d5a8e3`](https://github.com/taskforcesh/bullmq/commit/4d5a8e33b614cf099369c18298e5b2963b434b1b))


## v1.85.4 (2022-06-08)

### Chore

* chore(release): 1.85.4 [skip ci]

## [1.85.4](https://github.com/taskforcesh/bullmq/compare/v1.85.3...v1.85.4) (2022-06-08)

### Bug Fixes

* **error-prototype:** define custom name for toJSON method ([#1272](https://github.com/taskforcesh/bullmq/issues/1272)) ([66d80da](https://github.com/taskforcesh/bullmq/commit/66d80da4a6043755c7d296addb31857816ea4da3)) ([`9dbec4a`](https://github.com/taskforcesh/bullmq/commit/9dbec4a7329f650931abd198940b5a8c926fd6c1))

* chore(deps): bump semver-regex from 3.1.3 to 3.1.4 (#1269) ([`90592a2`](https://github.com/taskforcesh/bullmq/commit/90592a2f2b123fd2565ffc679a0efeaff83bde0d))

### Fix

* fix(error-prototype): define custom name for toJSON method (#1272) ([`66d80da`](https://github.com/taskforcesh/bullmq/commit/66d80da4a6043755c7d296addb31857816ea4da3))

### Refactor

* refactor(clean-jobs-in-set): split script into include functions (#1271) ([`f3fc053`](https://github.com/taskforcesh/bullmq/commit/f3fc053b33df2deb2cfa1f89d0c774e94c6d61d2))


## v1.85.3 (2022-06-03)

### Chore

* chore(release): 1.85.3 [skip ci]

## [1.85.3](https://github.com/taskforcesh/bullmq/compare/v1.85.2...v1.85.3) (2022-06-03)

### Bug Fixes

* **queue:** fix addBulk signature ResultType ([#1268](https://github.com/taskforcesh/bullmq/issues/1268)) ([f6770cc](https://github.com/taskforcesh/bullmq/commit/f6770cc383b68bf7b2fa655cd9eda713a06835aa)) ([`7ad899b`](https://github.com/taskforcesh/bullmq/commit/7ad899b55d35cc911afbbdd67b68bd06b001e39c))

### Documentation

* docs(concurrency): add concurrency update description (#1264) ([`7249012`](https://github.com/taskforcesh/bullmq/commit/7249012f189632957ee1ec62f563e1a7445f1cdb))

### Fix

* fix(queue): fix addBulk signature ResultType (#1268) ([`f6770cc`](https://github.com/taskforcesh/bullmq/commit/f6770cc383b68bf7b2fa655cd9eda713a06835aa))


## v1.85.2 (2022-06-01)

### Chore

* chore(release): 1.85.2 [skip ci]

## [1.85.2](https://github.com/taskforcesh/bullmq/compare/v1.85.1...v1.85.2) (2022-06-01)

### Bug Fixes

* **job:** save finishedOn attribute on instance ([#1267](https://github.com/taskforcesh/bullmq/issues/1267)) ([4cf6a63](https://github.com/taskforcesh/bullmq/commit/4cf6a63d197e6095841bb87cef297a9533ac79c3)) ([`137cd8e`](https://github.com/taskforcesh/bullmq/commit/137cd8e755a255db1083424c47bad2c183a0b2cc))

### Fix

* fix(job): save finishedOn attribute on instance (#1267) ([`4cf6a63`](https://github.com/taskforcesh/bullmq/commit/4cf6a63d197e6095841bb87cef297a9533ac79c3))


## v1.85.1 (2022-05-31)

### Chore

* chore(release): 1.85.1 [skip ci]

## [1.85.1](https://github.com/taskforcesh/bullmq/compare/v1.85.0...v1.85.1) (2022-05-31)

### Performance Improvements

* **remove-job:** send prefix key instead of jobKey ([#1252](https://github.com/taskforcesh/bullmq/issues/1252)) ([452856a](https://github.com/taskforcesh/bullmq/commit/452856a6c8c6e67ffda595c26c30988a15c1c1a4)) ([`d77bacc`](https://github.com/taskforcesh/bullmq/commit/d77baccd72ef904c415bf5d94b615d9d07770275))

### Performance

* perf(remove-job): send prefix key instead of jobKey (#1252) ([`452856a`](https://github.com/taskforcesh/bullmq/commit/452856a6c8c6e67ffda595c26c30988a15c1c1a4))


## v1.85.0 (2022-05-30)

### Chore

* chore(release): 1.85.0 [skip ci]

# [1.85.0](https://github.com/taskforcesh/bullmq/compare/v1.84.1...v1.85.0) (2022-05-30)

### Features

* **worker:** change the number of concurrent processes ([#1256](https://github.com/taskforcesh/bullmq/issues/1256)) ref [#22](https://github.com/taskforcesh/bullmq/issues/22) ([940dc8f](https://github.com/taskforcesh/bullmq/commit/940dc8f34d9a46dc9c8384661461bf0558e97600)) ([`9cfda3d`](https://github.com/taskforcesh/bullmq/commit/9cfda3d2dd640350d7b41f2449cd89318a237610))

### Documentation

* docs(step-jobs): fix waiting children step (#1261) ([`35b0283`](https://github.com/taskforcesh/bullmq/commit/35b028356e41ef3b646db44e1cfe7a1cf64d3f3e))

### Feature

* feat(worker): change the number of concurrent processes (#1256) ref #22 ([`940dc8f`](https://github.com/taskforcesh/bullmq/commit/940dc8f34d9a46dc9c8384661461bf0558e97600))


## v1.84.1 (2022-05-27)

### Chore

* chore(release): 1.84.1 [skip ci]

## [1.84.1](https://github.com/taskforcesh/bullmq/compare/v1.84.0...v1.84.1) (2022-05-27)

### Bug Fixes

* **waiting-children:** pass right timestamp value in moveToWaitingChildren ([#1260](https://github.com/taskforcesh/bullmq/issues/1260)) ([0f993f7](https://github.com/taskforcesh/bullmq/commit/0f993f71ed481b02a3f859a2109177352336cb9a)) ([`5d68aef`](https://github.com/taskforcesh/bullmq/commit/5d68aef2715d2ba474893bd343a34753f1e0eccb))

### Fix

* fix(waiting-children): pass right timestamp value in moveToWaitingChildren (#1260) ([`0f993f7`](https://github.com/taskforcesh/bullmq/commit/0f993f71ed481b02a3f859a2109177352336cb9a))


## v1.84.0 (2022-05-26)

### Chore

* chore(release): 1.84.0 [skip ci]

# [1.84.0](https://github.com/taskforcesh/bullmq/compare/v1.83.2...v1.84.0) (2022-05-26)

### Features

* **flow-producer:** add event listener types ([#1257](https://github.com/taskforcesh/bullmq/issues/1257)) ([19ed099](https://github.com/taskforcesh/bullmq/commit/19ed099905cbb4f071370b2b6d67d9a378e3a8f8)) ([`0dac923`](https://github.com/taskforcesh/bullmq/commit/0dac92327328838730cdee8ca33918611e05d5d9))

### Documentation

* docs(bullmq-pro): update changelog ([`2c7639d`](https://github.com/taskforcesh/bullmq/commit/2c7639d389c82370889f5164460ea2ef746931ba))

### Feature

* feat(flow-producer): add event listener types (#1257) ([`19ed099`](https://github.com/taskforcesh/bullmq/commit/19ed099905cbb4f071370b2b6d67d9a378e3a8f8))


## v1.83.2 (2022-05-24)

### Chore

* chore(release): 1.83.2 [skip ci]

## [1.83.2](https://github.com/taskforcesh/bullmq/compare/v1.83.1...v1.83.2) (2022-05-24)

### Bug Fixes

* **close:** emit ioredis:close event instead of error ([#1251](https://github.com/taskforcesh/bullmq/issues/1251)) fixes [#1231](https://github.com/taskforcesh/bullmq/issues/1231) ([74c1c38](https://github.com/taskforcesh/bullmq/commit/74c1c38f7ff468da1adc63aff160e31940d682a9)) ([`eb38636`](https://github.com/taskforcesh/bullmq/commit/eb38636346b5b679f6967671fbb3ca84fda68fd8))

### Fix

* fix(close): emit ioredis:close event instead of error (#1251) fixes #1231 ([`74c1c38`](https://github.com/taskforcesh/bullmq/commit/74c1c38f7ff468da1adc63aff160e31940d682a9))


## v1.83.1 (2022-05-24)

### Chore

* chore(release): 1.83.1 [skip ci]

## [1.83.1](https://github.com/taskforcesh/bullmq/compare/v1.83.0...v1.83.1) (2022-05-24)

### Bug Fixes

* **get-workers:** use blockingConnection client to set clientName ([#1255](https://github.com/taskforcesh/bullmq/issues/1255)) fixes [#1254](https://github.com/taskforcesh/bullmq/issues/1254) ([df796bd](https://github.com/taskforcesh/bullmq/commit/df796bd0c085aff72cef001395809b3f1a8045e4)) ([`41cc7f1`](https://github.com/taskforcesh/bullmq/commit/41cc7f1cade5410664873ffacb8569f37f6a409f))

### Documentation

* docs(bullmq-pro): update changelog ([`a705738`](https://github.com/taskforcesh/bullmq/commit/a70573854ca70310d80a761e940640083f8e311d))

### Fix

* fix(get-workers): use blockingConnection client to set clientName (#1255) fixes #1254 ([`df796bd`](https://github.com/taskforcesh/bullmq/commit/df796bd0c085aff72cef001395809b3f1a8045e4))


## v1.83.0 (2022-05-20)

### Chore

* chore(release): 1.83.0 [skip ci]

# [1.83.0](https://github.com/taskforcesh/bullmq/compare/v1.82.3...v1.83.0) (2022-05-20)

### Features

* **flow-producer:** easier to build extension ([#1250](https://github.com/taskforcesh/bullmq/issues/1250)) ([aaf637e](https://github.com/taskforcesh/bullmq/commit/aaf637e74b9610651fd9e4efc5ff349971b7bb26)) ([`44ee7cf`](https://github.com/taskforcesh/bullmq/commit/44ee7cff2e3570acda6ded8836fca91a11db3d15))

### Feature

* feat(flow-producer): easier to build extension (#1250) ([`aaf637e`](https://github.com/taskforcesh/bullmq/commit/aaf637e74b9610651fd9e4efc5ff349971b7bb26))


## v1.82.3 (2022-05-19)

### Chore

* chore(release): 1.82.3 [skip ci]

## [1.82.3](https://github.com/taskforcesh/bullmq/compare/v1.82.2...v1.82.3) (2022-05-19)

### Bug Fixes

* **redis-connection:** save cluster opts and coerse redis version ([#1247](https://github.com/taskforcesh/bullmq/issues/1247)) ref [#1246](https://github.com/taskforcesh/bullmq/issues/1246) fixes [#1243](https://github.com/taskforcesh/bullmq/issues/1243) ([acb69b5](https://github.com/taskforcesh/bullmq/commit/acb69b57d7a6417b8ca9fe1576a94d16e41f12d7)) ([`cd8ffa4`](https://github.com/taskforcesh/bullmq/commit/cd8ffa4958bba16b389114c8c37c847f8a6cf17a))

### Documentation

* docs(bullmq-pro): update changelog (#1244) ([`1e4e1bc`](https://github.com/taskforcesh/bullmq/commit/1e4e1bc729208fb0d2c423694e9e686418ed5aab))

### Fix

* fix(redis-connection): save cluster opts and coerse redis version (#1247) ref #1246 fixes #1243 ([`acb69b5`](https://github.com/taskforcesh/bullmq/commit/acb69b57d7a6417b8ca9fe1576a94d16e41f12d7))


## v1.82.2 (2022-05-17)

### Chore

* chore(release): 1.82.2 [skip ci]

## [1.82.2](https://github.com/taskforcesh/bullmq/compare/v1.82.1...v1.82.2) (2022-05-17)

### Bug Fixes

* **job:** add job helper attribute for extension ([#1242](https://github.com/taskforcesh/bullmq/issues/1242)) ([4d7ae9e](https://github.com/taskforcesh/bullmq/commit/4d7ae9e3fda23650e802ebac6b33ff3350f116f6)) ([`5d77e15`](https://github.com/taskforcesh/bullmq/commit/5d77e15a498e9d25349beabe55b4fa8e025f9c6d))

### Fix

* fix(job): add job helper attribute for extension (#1242) ([`4d7ae9e`](https://github.com/taskforcesh/bullmq/commit/4d7ae9e3fda23650e802ebac6b33ff3350f116f6))


## v1.82.1 (2022-05-16)

### Chore

* chore(release): 1.82.1 [skip ci]

## [1.82.1](https://github.com/taskforcesh/bullmq/compare/v1.82.0...v1.82.1) (2022-05-16)

### Bug Fixes

* **remove-job:** pass right prev param in removed event ([#1237](https://github.com/taskforcesh/bullmq/issues/1237)) ([54df47e](https://github.com/taskforcesh/bullmq/commit/54df47edf715a0a2a42687bf827e0a62c03951a5)) ([`547a853`](https://github.com/taskforcesh/bullmq/commit/547a85368ffedab4f642dea70813945050e53cf4))

### Fix

* fix(remove-job): pass right prev param in removed event (#1237) ([`54df47e`](https://github.com/taskforcesh/bullmq/commit/54df47edf715a0a2a42687bf827e0a62c03951a5))

### Refactor

* refactor(scripts): create class instance to handle scripts call (#1240) ([`87a16f0`](https://github.com/taskforcesh/bullmq/commit/87a16f0570d17e4db33fc5deb0131d4c8209704a))


## v1.82.0 (2022-05-11)

### Chore

* chore(release): 1.82.0 [skip ci]

# [1.82.0](https://github.com/taskforcesh/bullmq/compare/v1.81.4...v1.82.0) (2022-05-11)

### Features

* **remove-repeatable:** return boolean depending on job existence ([#1239](https://github.com/taskforcesh/bullmq/issues/1239)) ref [#1235](https://github.com/taskforcesh/bullmq/issues/1235) ([59b0da7](https://github.com/taskforcesh/bullmq/commit/59b0da7d0e979e4f9e8a5b042acbdce433790611)) ([`a0b179c`](https://github.com/taskforcesh/bullmq/commit/a0b179cba0349f166dc20f2bac28e1ea7f715592))

### Documentation

* docs(bullmq-pro): add version 2.0.3 changelog ([`a265398`](https://github.com/taskforcesh/bullmq/commit/a26539826479ff360e6313b3b9bad80a0c935caa))

* docs(bullmq-pro): add changelog (#1234) ([`fb1ece0`](https://github.com/taskforcesh/bullmq/commit/fb1ece0c534250b90452bcf021bc77779a7f35a3))

### Feature

* feat(remove-repeatable): return boolean depending on job existence (#1239) ref #1235 ([`59b0da7`](https://github.com/taskforcesh/bullmq/commit/59b0da7d0e979e4f9e8a5b042acbdce433790611))

### Refactor

* refactor(remove-jobs): remove timestamp param from removeJobsByMaxCount (#1233) ([`83465ff`](https://github.com/taskforcesh/bullmq/commit/83465ff391ea2ba050adc62bba5630d311f66fab))


## v1.81.4 (2022-05-05)

### Chore

* chore(release): 1.81.4 [skip ci]

## [1.81.4](https://github.com/taskforcesh/bullmq/compare/v1.81.3...v1.81.4) (2022-05-05)

### Bug Fixes

* **repeatable:** emit removed event when removing ([#1229](https://github.com/taskforcesh/bullmq/issues/1229)) ([7d2de8d](https://github.com/taskforcesh/bullmq/commit/7d2de8d075e5ee7774501429c5177b729c430c20)) ([`7edc886`](https://github.com/taskforcesh/bullmq/commit/7edc886fd2bc7ec18640e30e9eabaf1ea0ef6493))

### Fix

* fix(repeatable): emit removed event when removing (#1229) ([`7d2de8d`](https://github.com/taskforcesh/bullmq/commit/7d2de8d075e5ee7774501429c5177b729c430c20))


## v1.81.3 (2022-05-04)

### Chore

* chore(release): 1.81.3 [skip ci]

## [1.81.3](https://github.com/taskforcesh/bullmq/compare/v1.81.2...v1.81.3) (2022-05-04)

### Bug Fixes

* **remove-parent:** check removed record from waiting-children ([#1227](https://github.com/taskforcesh/bullmq/issues/1227)) ([e7b25d0](https://github.com/taskforcesh/bullmq/commit/e7b25d00acb860ee3df36c6214a7162b2cf79635)) ([`6cc16d6`](https://github.com/taskforcesh/bullmq/commit/6cc16d66fe5afd79ca9d2e3af9a135c8f47ca758))

### Fix

* fix(remove-parent): check removed record from waiting-children (#1227) ([`e7b25d0`](https://github.com/taskforcesh/bullmq/commit/e7b25d00acb860ee3df36c6214a7162b2cf79635))


## v1.81.2 (2022-05-03)

### Chore

* chore(release): 1.81.2 [skip ci]

## [1.81.2](https://github.com/taskforcesh/bullmq/compare/v1.81.1...v1.81.2) (2022-05-03)

### Bug Fixes

* **stalled:** consider removeOnFail when failing jobs ([#1225](https://github.com/taskforcesh/bullmq/issues/1225)) fixes [#1171](https://github.com/taskforcesh/bullmq/issues/1171) ([38486cb](https://github.com/taskforcesh/bullmq/commit/38486cb4d7cbfc78bd64d71f19d8bfbc908f3fc7)) ([`c175c13`](https://github.com/taskforcesh/bullmq/commit/c175c13c25f32987d65f2195fca6bba1840ed5c7))

### Fix

* fix(stalled): consider removeOnFail when failing jobs (#1225) fixes #1171 ([`38486cb`](https://github.com/taskforcesh/bullmq/commit/38486cb4d7cbfc78bd64d71f19d8bfbc908f3fc7))


## v1.81.1 (2022-04-29)

### Chore

* chore(release): 1.81.1 [skip ci]

## [1.81.1](https://github.com/taskforcesh/bullmq/compare/v1.81.0...v1.81.1) (2022-04-29)

### Bug Fixes

* **add-bulk:** use for loop and throw if error is present ([#1223](https://github.com/taskforcesh/bullmq/issues/1223)) fixes [#1222](https://github.com/taskforcesh/bullmq/issues/1222) ([564de4f](https://github.com/taskforcesh/bullmq/commit/564de4f907648f5a5667a845c5366f73cff1d384)) ([`22fae96`](https://github.com/taskforcesh/bullmq/commit/22fae96f2b03ace7b9d00390ef451c12ea14e3b4))

### Fix

* fix(add-bulk): use for loop and throw if error is present (#1223) fixes #1222 ([`564de4f`](https://github.com/taskforcesh/bullmq/commit/564de4f907648f5a5667a845c5366f73cff1d384))


## v1.81.0 (2022-04-26)

### Chore

* chore(release): 1.81.0 [skip ci]

# [1.81.0](https://github.com/taskforcesh/bullmq/compare/v1.80.6...v1.81.0) (2022-04-26)

### Features

* **move-to-delayed:** allow passing token ([#1213](https://github.com/taskforcesh/bullmq/issues/1213)) ([14f0e4a](https://github.com/taskforcesh/bullmq/commit/14f0e4a33d9ddfbaa1f86dbe7598e20a516a9d09)) ([`b01db23`](https://github.com/taskforcesh/bullmq/commit/b01db23ecf4947011d09870c5a2a7e76753cf3c4))

### Documentation

* docs: add missing read more sections ([`3e995f6`](https://github.com/taskforcesh/bullmq/commit/3e995f6dd70813da2dfea7c547fc20cbf24836da))

### Feature

* feat(move-to-delayed): allow passing token (#1213)

fix(move-to-waiting-children): delete lock ([`14f0e4a`](https://github.com/taskforcesh/bullmq/commit/14f0e4a33d9ddfbaa1f86dbe7598e20a516a9d09))

### Unknown

* GitBook: [#111] docs: add Curri in used by ([`60da723`](https://github.com/taskforcesh/bullmq/commit/60da723cc5f75b5e6bc4a1d55a3c0e31ba2bc6ad))

* GitBook: [#110] docs: update queues section links ([`73ac8c7`](https://github.com/taskforcesh/bullmq/commit/73ac8c75775083476e17a3e6ae62e4b4fe0fe6be))


## v1.80.6 (2022-04-22)

### Chore

* chore(release): 1.80.6 [skip ci]

## [1.80.6](https://github.com/taskforcesh/bullmq/compare/v1.80.5...v1.80.6) (2022-04-22)

### Bug Fixes

* **job:** delete token when moving to delayed ([#1208](https://github.com/taskforcesh/bullmq/issues/1208)) ([37acf41](https://github.com/taskforcesh/bullmq/commit/37acf4109d17090dfaef992267e48130d34f7187)) ([`86a1874`](https://github.com/taskforcesh/bullmq/commit/86a1874699bfe9bd9214344d6d4c451e148582b2))

### Fix

* fix(job): delete token when moving to delayed (#1208) ([`37acf41`](https://github.com/taskforcesh/bullmq/commit/37acf4109d17090dfaef992267e48130d34f7187))


## v1.80.5 (2022-04-21)

### Chore

* chore(release): 1.80.5 [skip ci]

## [1.80.5](https://github.com/taskforcesh/bullmq/compare/v1.80.4...v1.80.5) (2022-04-21)

### Bug Fixes

* **queue-base:** emit close error when no closing ([#1203](https://github.com/taskforcesh/bullmq/issues/1203)) fixes [#1205](https://github.com/taskforcesh/bullmq/issues/1205) ([4d76582](https://github.com/taskforcesh/bullmq/commit/4d7658272af94b57a09486e1141b0e15a7bac3ba)) ([`6cd3a19`](https://github.com/taskforcesh/bullmq/commit/6cd3a19a68ee308ad2d8e1c79b34ffee55efdf30))

### Documentation

* docs: change order of summary ([`7a3206f`](https://github.com/taskforcesh/bullmq/commit/7a3206fe97cf801db4042cfe96a912c695037916))

* docs: fix README.md heading ([`dda13cf`](https://github.com/taskforcesh/bullmq/commit/dda13cfa898f24f0b31de58e2f24d55f097e1476))

### Fix

* fix(queue-base): emit close error when no closing (#1203) fixes #1205 ([`4d76582`](https://github.com/taskforcesh/bullmq/commit/4d7658272af94b57a09486e1141b0e15a7bac3ba))


## v1.80.4 (2022-04-19)

### Chore

* chore(release): 1.80.4 [skip ci]

## [1.80.4](https://github.com/taskforcesh/bullmq/compare/v1.80.3...v1.80.4) (2022-04-19)

### Bug Fixes

* **queue-scheduler:** apply isNotConnectionError ([#1189](https://github.com/taskforcesh/bullmq/issues/1189)) fixes [#1181](https://github.com/taskforcesh/bullmq/issues/1181) ([605d685](https://github.com/taskforcesh/bullmq/commit/605d68595d8fa1d9d47348a3fa9e0d7a4e28c706)) ([`d48fe2a`](https://github.com/taskforcesh/bullmq/commit/d48fe2a35b20cdbcd4d84861bc3fb607f64631b7))

### Fix

* fix(queue-scheduler): apply isNotConnectionError (#1189) fixes #1181 ([`605d685`](https://github.com/taskforcesh/bullmq/commit/605d68595d8fa1d9d47348a3fa9e0d7a4e28c706))


## v1.80.3 (2022-04-15)

### Chore

* chore(release): 1.80.3 [skip ci]

## [1.80.3](https://github.com/taskforcesh/bullmq/compare/v1.80.2...v1.80.3) (2022-04-15)

### Bug Fixes

* **cluster:** check correct Upstash host ([#1195](https://github.com/taskforcesh/bullmq/issues/1195)) fixes [#1193](https://github.com/taskforcesh/bullmq/issues/1193) ([69f2863](https://github.com/taskforcesh/bullmq/commit/69f28632408c741219c1ba49304d36f49cf5cb83)) ([`e347cdb`](https://github.com/taskforcesh/bullmq/commit/e347cdbabcb142060592e541f35aa94730196700))

* chore: upgrade typescript to version 4.6.x ([`445a031`](https://github.com/taskforcesh/bullmq/commit/445a0310219c6cd3dfebc6ca82cca985e3d84912))

### Documentation

* docs: add link to bullmq-pro api reference ([`52fdc61`](https://github.com/taskforcesh/bullmq/commit/52fdc61a100090a236b2c990df8e826701ad697b))

* docs: fix link to api reference ([`7e3df91`](https://github.com/taskforcesh/bullmq/commit/7e3df91a068421851ad8ae10a87d6c86235ffcdc))

* docs: remove readme from api docs ([`da8a310`](https://github.com/taskforcesh/bullmq/commit/da8a310f2e90be480ba4541c105d2d25e39c1240))

* docs: add missing typedoc dependency ([`ab7f1b5`](https://github.com/taskforcesh/bullmq/commit/ab7f1b54b2e22a76e0640f6fe7bc4e54417fbda1))

* docs: add new api based on typedoc ([`8e56db5`](https://github.com/taskforcesh/bullmq/commit/8e56db551e1f0f187c2ae56c22b70342f9106822))

### Fix

* fix(cluster): check correct Upstash host (#1195) fixes #1193 ([`69f2863`](https://github.com/taskforcesh/bullmq/commit/69f28632408c741219c1ba49304d36f49cf5cb83))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`892e80b`](https://github.com/taskforcesh/bullmq/commit/892e80b097b808e81e8091d3696ab64ee1a534a9))


## v1.80.2 (2022-04-15)

### Chore

* chore(release): 1.80.2 [skip ci]

## [1.80.2](https://github.com/taskforcesh/bullmq/compare/v1.80.1...v1.80.2) (2022-04-15)

### Bug Fixes

* **job:** remove Error from Promise return in moveToWaitingChildren ([#1197](https://github.com/taskforcesh/bullmq/issues/1197)) ([180a8bf](https://github.com/taskforcesh/bullmq/commit/180a8bf8fb2fe62b9929765a6dfd084574c77936)) ([`d83842d`](https://github.com/taskforcesh/bullmq/commit/d83842dc346f9308f52cf7dfda5ad2fc050eef4e))

### Fix

* fix(job): remove Error from Promise return in moveToWaitingChildren (#1197) ([`180a8bf`](https://github.com/taskforcesh/bullmq/commit/180a8bf8fb2fe62b9929765a6dfd084574c77936))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`99ae4c0`](https://github.com/taskforcesh/bullmq/commit/99ae4c0c6e80a51b9220acb9b74c8202d2d3a830))


## v1.80.1 (2022-04-14)

### Chore

* chore(release): 1.80.1 [skip ci]

## [1.80.1](https://github.com/taskforcesh/bullmq/compare/v1.80.0...v1.80.1) (2022-04-14)

### Bug Fixes

* **worker:** restore worker suffix to empty string ([#1194](https://github.com/taskforcesh/bullmq/issues/1194)) fixes [#1185](https://github.com/taskforcesh/bullmq/issues/1185) ([2666ea5](https://github.com/taskforcesh/bullmq/commit/2666ea5b8532645da24482cf01c5692da5f2ceda)) ([`3901472`](https://github.com/taskforcesh/bullmq/commit/3901472f30c090d8c26a34ccc1fb666193a91ca0))

### Fix

* fix(worker): restore worker suffix to empty string (#1194) fixes #1185 ([`2666ea5`](https://github.com/taskforcesh/bullmq/commit/2666ea5b8532645da24482cf01c5692da5f2ceda))


## v1.80.0 (2022-04-12)

### Chore

* chore(release): 1.80.0 [skip ci]

# [1.80.0](https://github.com/taskforcesh/bullmq/compare/v1.79.1...v1.80.0) (2022-04-12)

### Features

* **worker-listener:** use generics in events ([#1190](https://github.com/taskforcesh/bullmq/issues/1190)) ref [#1188](https://github.com/taskforcesh/bullmq/issues/1188) ([2821193](https://github.com/taskforcesh/bullmq/commit/28211937d9ed405330eede5ad7d4b0b817accf39)) ([`3ac9dd0`](https://github.com/taskforcesh/bullmq/commit/3ac9dd002f0dcedf83312708222c39041d23c2c0))

### Feature

* feat(worker-listener): use generics in events (#1190) ref #1188 ([`2821193`](https://github.com/taskforcesh/bullmq/commit/28211937d9ed405330eede5ad7d4b0b817accf39))


## v1.79.1 (2022-04-12)

### Chore

* chore(release): 1.79.1 [skip ci]

## [1.79.1](https://github.com/taskforcesh/bullmq/compare/v1.79.0...v1.79.1) (2022-04-12)

### Bug Fixes

* **connection:** remove Queue reconnect overrides ([#1119](https://github.com/taskforcesh/bullmq/issues/1119)) ([83f1c79](https://github.com/taskforcesh/bullmq/commit/83f1c797b8a5272028c8d78d5ce464236e90909e)) ([`56ffa3c`](https://github.com/taskforcesh/bullmq/commit/56ffa3c918c1c642f0ffeae4952fc57cfbd13abd))

* chore(deps-dev): bump moment from 2.29.1 to 2.29.2 (#1184) ([`e27986e`](https://github.com/taskforcesh/bullmq/commit/e27986e06dc39c1ee983733deb8188fa78c797d1))

### Fix

* fix(connection): remove Queue reconnect overrides (#1119) ([`83f1c79`](https://github.com/taskforcesh/bullmq/commit/83f1c797b8a5272028c8d78d5ce464236e90909e))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`8f0bbda`](https://github.com/taskforcesh/bullmq/commit/8f0bbda3332ce3dd3712e9812963733c117d2b74))


## v1.79.0 (2022-04-08)

### Chore

* chore(release): 1.79.0 [skip ci]

# [1.79.0](https://github.com/taskforcesh/bullmq/compare/v1.78.2...v1.79.0) (2022-04-08)

### Features

* **queue-getters:** add getQueueEvents ([#1085](https://github.com/taskforcesh/bullmq/issues/1085)) ([f10a20a](https://github.com/taskforcesh/bullmq/commit/f10a20a90ab6dbf2d9f3f75ba99dacbdc797c329)) ([`cb46ff7`](https://github.com/taskforcesh/bullmq/commit/cb46ff78e1f22b7ae94e37adfcc91f2ed4041355))

* chore(redis-connection):  coerce redis version to standard semver format ([`3828767`](https://github.com/taskforcesh/bullmq/commit/382876791c9d2a8cb8f3550f7c6eab97bb30d899))

### Documentation

* docs(readme): better layout in &#34;used by&#34; ([`094ec8f`](https://github.com/taskforcesh/bullmq/commit/094ec8fb8f2655b9b4fd0752dcde36e5526fe333))

* docs(readme): add curri in &#34;used by&#34; ([`931a932`](https://github.com/taskforcesh/bullmq/commit/931a932e25cee430cbe5a126fd8dd6f7e704756a))

### Feature

* feat(queue-getters): add getQueueEvents (#1085) ([`f10a20a`](https://github.com/taskforcesh/bullmq/commit/f10a20a90ab6dbf2d9f3f75ba99dacbdc797c329))

### Refactor

* refactor(get-workers): add worker suffix (#1176) ([`8376f4c`](https://github.com/taskforcesh/bullmq/commit/8376f4c055fc134bb51d6605a4ddffbffdf5130e))

* refactor(backoff-options): improve IntelliSense for backoff types (#1168) ([`1633c5b`](https://github.com/taskforcesh/bullmq/commit/1633c5b85555a3c7f90e535dd8dcfce2e2127b86))

### Test

* test(events): fix flaky test ([`ee7fb35`](https://github.com/taskforcesh/bullmq/commit/ee7fb35bd622297f20ee83079715aec5ab9e30ab))


## v1.78.2 (2022-03-31)

### Chore

* chore(release): 1.78.2 [skip ci]

## [1.78.2](https://github.com/taskforcesh/bullmq/compare/v1.78.1...v1.78.2) (2022-03-31)

### Bug Fixes

* **clean:** consider processedOn and finishedOn attributes ([#1158](https://github.com/taskforcesh/bullmq/issues/1158)) ([8c3cb72](https://github.com/taskforcesh/bullmq/commit/8c3cb72235ec6123da389553f37433c2943e0f57)) ([`3c75df5`](https://github.com/taskforcesh/bullmq/commit/3c75df5c9bc8f7ba5db9638b0aaeefb00903105d))

### Documentation

* docs: misspelled rate limited (#1165) ([`f33d0a9`](https://github.com/taskforcesh/bullmq/commit/f33d0a957525ec1bc3986e4bb57624d5ac0a4bc1))

* docs(worker): add autorun example (#1161) ([`ad159ad`](https://github.com/taskforcesh/bullmq/commit/ad159ad6a4bda3703ce1686b4989e1fae7dcaef8))

* docs(metrics): fix typo ([`7ff86b2`](https://github.com/taskforcesh/bullmq/commit/7ff86b23525392937914c2336f22c7d2ae89f6e9))

### Fix

* fix(clean): consider processedOn and finishedOn attributes (#1158) ([`8c3cb72`](https://github.com/taskforcesh/bullmq/commit/8c3cb72235ec6123da389553f37433c2943e0f57))

### Unknown

* GitBook: [#106] No subject ([`8271109`](https://github.com/taskforcesh/bullmq/commit/8271109a2a11af46ac23cf8b1e3a4d63ef1c27c7))

* GitBook: [#105] No subject ([`a27a9a3`](https://github.com/taskforcesh/bullmq/commit/a27a9a3b82362330de29e174a8353bfc264bd516))


## v1.78.1 (2022-03-24)

### Chore

* chore(release): 1.78.1 [skip ci]

## [1.78.1](https://github.com/taskforcesh/bullmq/compare/v1.78.0...v1.78.1) (2022-03-24)

### Bug Fixes

* **queue:** close repeat connection when calling close ([#1154](https://github.com/taskforcesh/bullmq/issues/1154)) ([7d79616](https://github.com/taskforcesh/bullmq/commit/7d796167229048ec79660ca5d3ac8a7c85d125e7)) ([`04d0992`](https://github.com/taskforcesh/bullmq/commit/04d09929a8cd2a79d335e27f97543b62ca105191))

### Fix

* fix(queue): close repeat connection when calling close (#1154) ([`7d79616`](https://github.com/taskforcesh/bullmq/commit/7d796167229048ec79660ca5d3ac8a7c85d125e7))


## v1.78.0 (2022-03-23)

### Chore

* chore(release): 1.78.0 [skip ci]

# [1.78.0](https://github.com/taskforcesh/bullmq/compare/v1.77.3...v1.78.0) (2022-03-23)

### Features

* **cron-parser:** upgrades version to 4.2.1 ([#1149](https://github.com/taskforcesh/bullmq/issues/1149)) fixes [#1147](https://github.com/taskforcesh/bullmq/issues/1147) ([88a6c9c](https://github.com/taskforcesh/bullmq/commit/88a6c9c437172035173628842909f5170eb481f7)) ([`cc5c695`](https://github.com/taskforcesh/bullmq/commit/cc5c695b689df2e319c519aae316e4df2bf194b5))

### Feature

* feat(cron-parser): upgrades version to 4.2.1 (#1149) fixes #1147 ([`88a6c9c`](https://github.com/taskforcesh/bullmq/commit/88a6c9c437172035173628842909f5170eb481f7))

### Test

* test(events): fix flaky test ([`1788833`](https://github.com/taskforcesh/bullmq/commit/17888335138fafd888689a894372ee059ca714ec))


## v1.77.3 (2022-03-22)

### Chore

* chore(release): 1.77.3 [skip ci]

## [1.77.3](https://github.com/taskforcesh/bullmq/compare/v1.77.2...v1.77.3) (2022-03-22)

### Bug Fixes

* **async-send:** check proc.send type ([#1150](https://github.com/taskforcesh/bullmq/issues/1150)) ([4f44173](https://github.com/taskforcesh/bullmq/commit/4f44173f0a3cc54705ca9a7e1730aeff26ea1c5a)) ([`fd8742b`](https://github.com/taskforcesh/bullmq/commit/fd8742b1746443a670789b5dbf668e84425f5897))

### Fix

* fix(async-send): check proc.send type (#1150) ([`4f44173`](https://github.com/taskforcesh/bullmq/commit/4f44173f0a3cc54705ca9a7e1730aeff26ea1c5a))

### Test

* test(rate-limiter): fix flaky test ([`a9c11c9`](https://github.com/taskforcesh/bullmq/commit/a9c11c9751bf8be6e6b263ffc95960b1c1ab7ce4))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`24b4026`](https://github.com/taskforcesh/bullmq/commit/24b4026be2bd831a8e7609f5a9611ac0ed4c6d89))


## v1.77.2 (2022-03-20)

### Chore

* chore(release): 1.77.2 [skip ci]

## [1.77.2](https://github.com/taskforcesh/bullmq/compare/v1.77.1...v1.77.2) (2022-03-20)

### Bug Fixes

* **trim-events:** consider maxLenEvents as 0 ([#1137](https://github.com/taskforcesh/bullmq/issues/1137)) ([bc58a49](https://github.com/taskforcesh/bullmq/commit/bc58a49fba1b6f4e3595a0371ecf8410000a9021))

### Performance Improvements

* **clean:** speed up clean operation using deletion marker ([#1144](https://github.com/taskforcesh/bullmq/issues/1144)) ([5fb32ef](https://github.com/taskforcesh/bullmq/commit/5fb32ef2c60843d8d1f2cbc000aacf4df3388b7e)) ([`41ba863`](https://github.com/taskforcesh/bullmq/commit/41ba8631c76477a46af4a23cfad5365d78d77409))

### Fix

* fix(trim-events): consider maxLenEvents as 0 (#1137) ([`bc58a49`](https://github.com/taskforcesh/bullmq/commit/bc58a49fba1b6f4e3595a0371ecf8410000a9021))

### Performance

* perf(clean): speed up clean operation using deletion marker (#1144) ([`5fb32ef`](https://github.com/taskforcesh/bullmq/commit/5fb32ef2c60843d8d1f2cbc000aacf4df3388b7e))


## v1.77.1 (2022-03-17)

### Chore

* chore(release): 1.77.1 [skip ci]

## [1.77.1](https://github.com/taskforcesh/bullmq/compare/v1.77.0...v1.77.1) (2022-03-17)

### Bug Fixes

* **flow:** remove processed children ([#1060](https://github.com/taskforcesh/bullmq/issues/1060)) fixes [#1056](https://github.com/taskforcesh/bullmq/issues/1056) ([6b54e86](https://github.com/taskforcesh/bullmq/commit/6b54e86c12f287a13da036f3ec7801b8656f0434)) ([`ed9dd80`](https://github.com/taskforcesh/bullmq/commit/ed9dd801533d714baacc64c469b8b94564a22b98))

### Fix

* fix(flow): remove processed children (#1060) fixes #1056 ([`6b54e86`](https://github.com/taskforcesh/bullmq/commit/6b54e86c12f287a13da036f3ec7801b8656f0434))


## v1.77.0 (2022-03-16)

### Chore

* chore(release): 1.77.0 [skip ci]

# [1.77.0](https://github.com/taskforcesh/bullmq/compare/v1.76.6...v1.77.0) (2022-03-16)

### Features

* allow QueueScheduler to be extended ([289beb8](https://github.com/taskforcesh/bullmq/commit/289beb87d2ef3e3dd7583159f7be2b5450f7de3c)) ([`a178ae4`](https://github.com/taskforcesh/bullmq/commit/a178ae4c2fa6d7ece5ebda79c11164be761968a5))

### Feature

* feat: allow QueueScheduler to be extended ([`289beb8`](https://github.com/taskforcesh/bullmq/commit/289beb87d2ef3e3dd7583159f7be2b5450f7de3c))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`10fdcd3`](https://github.com/taskforcesh/bullmq/commit/10fdcd37fb3c1d115b878f7ca489d711cca3ff6a))


## v1.76.6 (2022-03-15)

### Chore

* chore(release): 1.76.6 [skip ci]

## [1.76.6](https://github.com/taskforcesh/bullmq/compare/v1.76.5...v1.76.6) (2022-03-15)

### Bug Fixes

* **master:** do not export master file ([#1136](https://github.com/taskforcesh/bullmq/issues/1136)) fixes [#1125](https://github.com/taskforcesh/bullmq/issues/1125) ref [#1129](https://github.com/taskforcesh/bullmq/issues/1129) ([6aa2f96](https://github.com/taskforcesh/bullmq/commit/6aa2f9657b8787aa791ab5af7267a6d27d7d7869)) ([`96de7b4`](https://github.com/taskforcesh/bullmq/commit/96de7b43fd01a94b28991f9af24b4e6b2a6c0fc2))

### Fix

* fix(master): do not export master file (#1136) fixes #1125 ref #1129 ([`6aa2f96`](https://github.com/taskforcesh/bullmq/commit/6aa2f9657b8787aa791ab5af7267a6d27d7d7869))


## v1.76.5 (2022-03-15)

### Chore

* chore(release): 1.76.5 [skip ci]

## [1.76.5](https://github.com/taskforcesh/bullmq/compare/v1.76.4...v1.76.5) (2022-03-15)

### Bug Fixes

* **queue:** sanitize job types in getJobs and getJobsCount ([#1113](https://github.com/taskforcesh/bullmq/issues/1113)) fixes [#1112](https://github.com/taskforcesh/bullmq/issues/1112) ([d452b29](https://github.com/taskforcesh/bullmq/commit/d452b29773cead153a73b8322adda3164fb610d8)) ([`0e74cfa`](https://github.com/taskforcesh/bullmq/commit/0e74cfac4efe7a2d62460ed8e646593f8b48a850))

### Fix

* fix(queue): sanitize job types in getJobs and getJobsCount (#1113) fixes #1112 ([`d452b29`](https://github.com/taskforcesh/bullmq/commit/d452b29773cead153a73b8322adda3164fb610d8))

### Test

* test(rate-limit): add cases when promoting jobs (#1135) fixes #1083 ([`51343c9`](https://github.com/taskforcesh/bullmq/commit/51343c95f4823fedd7d7295d59ad5a092ae8dcbf))


## v1.76.4 (2022-03-13)

### Chore

* chore(release): 1.76.4 [skip ci]

## [1.76.4](https://github.com/taskforcesh/bullmq/compare/v1.76.3...v1.76.4) (2022-03-13)

### Performance Improvements

* **move-to-finished:** avoid an extra roundtrip when using rate limit ([#1131](https://github.com/taskforcesh/bullmq/issues/1131)) ([1711547](https://github.com/taskforcesh/bullmq/commit/171154707bf5cbcb750ea9d2a9957128c1abc044)) ([`f713474`](https://github.com/taskforcesh/bullmq/commit/f71347415f4fd04c9a59a94a24ceac11ab320e01))

### Documentation

* docs: clarify jobs priority order (#1124) ([`7721ac3`](https://github.com/taskforcesh/bullmq/commit/7721ac3a01ca5071bcf4b51df3ca0ad0a896659b))

### Performance

* perf(move-to-finished): avoid an extra roundtrip when using rate limit (#1131) ([`1711547`](https://github.com/taskforcesh/bullmq/commit/171154707bf5cbcb750ea9d2a9957128c1abc044))

### Refactor

* refactor(move-to-finished): pass some args using pack (#1128) ([`b60ac86`](https://github.com/taskforcesh/bullmq/commit/b60ac86b4684ee6cc3b931238b59d3aecf1af44f))

### Unknown

* GitBook: [#104] No subject ([`f718340`](https://github.com/taskforcesh/bullmq/commit/f7183404f04a83ba559f915b38a81316ae2fe0ff))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`0870974`](https://github.com/taskforcesh/bullmq/commit/087097422aa9e0d5efbccb1e858d1692e4e22c88))


## v1.76.3 (2022-03-10)

### Chore

* chore(release): 1.76.3 [skip ci]

## [1.76.3](https://github.com/taskforcesh/bullmq/compare/v1.76.2...v1.76.3) (2022-03-10)

### Bug Fixes

* **drained:** emit event only once when queue has drained the waiting list ([#1123](https://github.com/taskforcesh/bullmq/issues/1123)) fixes [#1121](https://github.com/taskforcesh/bullmq/issues/1121) ref [#1070](https://github.com/taskforcesh/bullmq/issues/1070) ([b89b4e8](https://github.com/taskforcesh/bullmq/commit/b89b4e8a83fe4c9349ac5a9c439fc07374ff1e63)) ([`e37f6f8`](https://github.com/taskforcesh/bullmq/commit/e37f6f8eed5589b69ed7a2ed27e951846fbfbb0c))

### Fix

* fix(drained): emit event only once when queue has drained the waiting list (#1123) fixes #1121 ref #1070 ([`b89b4e8`](https://github.com/taskforcesh/bullmq/commit/b89b4e8a83fe4c9349ac5a9c439fc07374ff1e63))

### Unknown

* GitBook: [#103] No subject ([`bab62d1`](https://github.com/taskforcesh/bullmq/commit/bab62d1f49748de254ca7cfeaab4b7cf2009ff96))


## v1.76.2 (2022-03-09)

### Chore

* chore(release): 1.76.2 [skip ci]

## [1.76.2](https://github.com/taskforcesh/bullmq/compare/v1.76.1...v1.76.2) (2022-03-09)

### Bug Fixes

* **utils:** fix proc.send type ([#1122](https://github.com/taskforcesh/bullmq/issues/1122)) fixes [#1120](https://github.com/taskforcesh/bullmq/issues/1120) ([da23977](https://github.com/taskforcesh/bullmq/commit/da239774379825d9f0a51c118740bc0fefa568bd)) ([`88ac8e5`](https://github.com/taskforcesh/bullmq/commit/88ac8e551574bdd00cbd644aa1ea5bf75f03fa5e))

* chore(deps): upgrade gitbook-plugin-mermaid-compat ([`14a4099`](https://github.com/taskforcesh/bullmq/commit/14a40999c0a120480bccd7567e61d61b31779867))

### Documentation

* docs: add mermaid diagrams as comments(#1116) ([`1d69619`](https://github.com/taskforcesh/bullmq/commit/1d69619fcc70c24cca8a5d30451886b6cb487e5c))

* docs(architecture): restore diagram ([`b0a3315`](https://github.com/taskforcesh/bullmq/commit/b0a3315db650ee88a7d6dc61c16d764e06803537))

* docs: try mermaid-gitbook example ([`dc5c396`](https://github.com/taskforcesh/bullmq/commit/dc5c3962a99e557ae8b8800ea2112485658c2b35))

* docs(package): add mermaid-compat plugin ([`1978fdf`](https://github.com/taskforcesh/bullmq/commit/1978fdf121f4ee2988d767c5655249f040d6be65))

* docs(architecture): replace state diagram ([`71a95c7`](https://github.com/taskforcesh/bullmq/commit/71a95c784f3add49d1a3e273f0a4771fc7275234))

* docs(architecture): use mermaid in state diagram ([`5d5e9d4`](https://github.com/taskforcesh/bullmq/commit/5d5e9d4418e286a2fda73468c13a8d5ff58c36f6))

### Fix

* fix(utils): fix proc.send type (#1122) fixes #1120 ([`da23977`](https://github.com/taskforcesh/bullmq/commit/da239774379825d9f0a51c118740bc0fefa568bd))

### Unknown

* GitBook: [#102] No subject ([`35a7349`](https://github.com/taskforcesh/bullmq/commit/35a734964ebea256708e4583f1514245a4bcf6da))

* GitBook: [#100] No subject ([`edfbf62`](https://github.com/taskforcesh/bullmq/commit/edfbf623c39b510163dc2024eb4808d3dcefc6ff))

* GitBook: [#99] No subject ([`b710285`](https://github.com/taskforcesh/bullmq/commit/b710285a67271c0b2c1be6d602d858b6025166b5))

* GitBook: [#98] No subject ([`8e908dd`](https://github.com/taskforcesh/bullmq/commit/8e908ddc74bc6886b58ac9297844a648cf0808ad))

* GitBook: [#97] No subject ([`d196217`](https://github.com/taskforcesh/bullmq/commit/d1962177c2c684c70389b946e614ada883bf6a54))

* GitBook: [#96] No subject ([`3f46a47`](https://github.com/taskforcesh/bullmq/commit/3f46a470ccd65b07df66b0004a49294dabaae73a))


## v1.76.1 (2022-03-04)

### Chore

* chore(release): 1.76.1 [skip ci]

## [1.76.1](https://github.com/taskforcesh/bullmq/compare/v1.76.0...v1.76.1) (2022-03-04)

### Bug Fixes

* **get-waiting-children-count:** consider waiting-children status only ([#1117](https://github.com/taskforcesh/bullmq/issues/1117)) ([1820df7](https://github.com/taskforcesh/bullmq/commit/1820df73c17ce119d2fdb0f526fc95f99845a5ec)) ([`485def0`](https://github.com/taskforcesh/bullmq/commit/485def0cbb9970e5b85775a549a132016ddef6f4))

### Documentation

* docs: add read more section (#1114) ([`3ba05f7`](https://github.com/taskforcesh/bullmq/commit/3ba05f7ff80b152cd99167b13546d6d76654d3ed))

* docs(guide): add link references to classes (#1111) ([`350234e`](https://github.com/taskforcesh/bullmq/commit/350234e816783ff7a4e91d4839d81ac4fe2b2a1d))

### Fix

* fix(get-waiting-children-count): consider waiting-children status only (#1117) ([`1820df7`](https://github.com/taskforcesh/bullmq/commit/1820df73c17ce119d2fdb0f526fc95f99845a5ec))


## v1.76.0 (2022-03-02)

### Chore

* chore(release): 1.76.0 [skip ci]

# [1.76.0](https://github.com/taskforcesh/bullmq/compare/v1.75.1...v1.76.0) (2022-03-02)

### Features

* **metrics:** add metrics support ([ab51326](https://github.com/taskforcesh/bullmq/commit/ab51326cf318b4b48e37a1a77f5609e405eecb45)) ([`359e4e5`](https://github.com/taskforcesh/bullmq/commit/359e4e54b633237ec01107e862c109e8712824dc))

### Feature

* feat(metrics): add metrics support ([`ab51326`](https://github.com/taskforcesh/bullmq/commit/ab51326cf318b4b48e37a1a77f5609e405eecb45))


## v1.75.1 (2022-02-26)

### Chore

* chore(release): 1.75.1 [skip ci]

## [1.75.1](https://github.com/taskforcesh/bullmq/compare/v1.75.0...v1.75.1) (2022-02-26)

### Bug Fixes

* **rate-limiter:** move job to wait after retry when groupKey is missed ([#1103](https://github.com/taskforcesh/bullmq/issues/1103)) fixes [#1084](https://github.com/taskforcesh/bullmq/issues/1084) ([8aeab37](https://github.com/taskforcesh/bullmq/commit/8aeab37ac5a5c1c760be21bff2ba8752a485577c)) ([`779f6db`](https://github.com/taskforcesh/bullmq/commit/779f6db7b5b0da0324a187f4b735ec6762abc9ad))

### Fix

* fix(rate-limiter): move job to wait after retry when groupKey is missed (#1103) fixes #1084 ([`8aeab37`](https://github.com/taskforcesh/bullmq/commit/8aeab37ac5a5c1c760be21bff2ba8752a485577c))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`73b9950`](https://github.com/taskforcesh/bullmq/commit/73b995091439727a9a85e3eee1cb8fdfcab9a090))


## v1.75.0 (2022-02-24)

### Chore

* chore(release): 1.75.0 [skip ci]

# [1.75.0](https://github.com/taskforcesh/bullmq/compare/v1.74.3...v1.75.0) (2022-02-24)

### Bug Fixes

* **cluster:** check for host presence in Upstash validation ([#1102](https://github.com/taskforcesh/bullmq/issues/1102)) fixes [#1101](https://github.com/taskforcesh/bullmq/issues/1101) ([54d4eac](https://github.com/taskforcesh/bullmq/commit/54d4eac52cfe13d4be99410932c0226c8d06d5d5))

### Features

* **retry-jobs:** allow to retry completed jobs ([#1082](https://github.com/taskforcesh/bullmq/issues/1082)) ([e17b3f2](https://github.com/taskforcesh/bullmq/commit/e17b3f21606757a16630988a69c9607e8c843bd2)) ([`7f11b7d`](https://github.com/taskforcesh/bullmq/commit/7f11b7d741f32101e1dc895ca931647fe9d4c81f))

### Feature

* feat(retry-jobs): allow to retry completed jobs (#1082) ([`e17b3f2`](https://github.com/taskforcesh/bullmq/commit/e17b3f21606757a16630988a69c9607e8c843bd2))

### Fix

* fix(cluster): check for host presence in Upstash validation (#1102) fixes #1101 ([`54d4eac`](https://github.com/taskforcesh/bullmq/commit/54d4eac52cfe13d4be99410932c0226c8d06d5d5))


## v1.74.3 (2022-02-24)

### Chore

* chore(release): 1.74.3 [skip ci]

## [1.74.3](https://github.com/taskforcesh/bullmq/compare/v1.74.2...v1.74.3) (2022-02-24)

### Bug Fixes

* **connection:** throw error when Upstash host is provided ([#1098](https://github.com/taskforcesh/bullmq/issues/1098)) fixes [#1087](https://github.com/taskforcesh/bullmq/issues/1087) ([5156d0a](https://github.com/taskforcesh/bullmq/commit/5156d0a4812d8c649a3b41bd98e3e0efb41d0491)) ([`df2fa62`](https://github.com/taskforcesh/bullmq/commit/df2fa62064c9bc1a21b9410e48042257e0a1c57b))

### Documentation

* docs(procesador): add pattern for named processor (#1096) ([`dd1e63c`](https://github.com/taskforcesh/bullmq/commit/dd1e63c623a6a1958ff8de983adc668e452aed52))

### Fix

* fix(connection): throw error when Upstash host is provided (#1098) fixes #1087 ([`5156d0a`](https://github.com/taskforcesh/bullmq/commit/5156d0a4812d8c649a3b41bd98e3e0efb41d0491))


## v1.74.2 (2022-02-23)

### Chore

* chore(release): 1.74.2 [skip ci]

## [1.74.2](https://github.com/taskforcesh/bullmq/compare/v1.74.1...v1.74.2) (2022-02-23)

### Bug Fixes

* **move-to-finished:** increment attemptsMade when moving job to active ([#1095](https://github.com/taskforcesh/bullmq/issues/1095)) fixes [#1094](https://github.com/taskforcesh/bullmq/issues/1094) ([321b0e1](https://github.com/taskforcesh/bullmq/commit/321b0e1d515d01c5b3f1ca9f404cd571e3f753b7)) ([`023cf74`](https://github.com/taskforcesh/bullmq/commit/023cf745e92c318b21251e4cedbedf3949c57abe))

### Fix

* fix(move-to-finished): increment attemptsMade when moving job to active (#1095) fixes #1094 ([`321b0e1`](https://github.com/taskforcesh/bullmq/commit/321b0e1d515d01c5b3f1ca9f404cd571e3f753b7))

### Unknown

* GitBook: [#95] No subject ([`edf8bf6`](https://github.com/taskforcesh/bullmq/commit/edf8bf6981eeaf3756ce7ae0f2d0000ca3a8ff7d))

* GitBook: [#94] No subject ([`bbdb07b`](https://github.com/taskforcesh/bullmq/commit/bbdb07b947d5a0569719d89339b94237b35292f8))

* GitBook: [#93] No subject ([`b9d040a`](https://github.com/taskforcesh/bullmq/commit/b9d040a83d8892bb99760075eec784a707c0cfda))

* GitBook: [#92] No subject ([`d19f1f0`](https://github.com/taskforcesh/bullmq/commit/d19f1f05a9757006ada6ea5ad6d2b6058cda0b01))


## v1.74.1 (2022-02-20)

### Chore

* chore(release): 1.74.1 [skip ci]

## [1.74.1](https://github.com/taskforcesh/bullmq/compare/v1.74.0...v1.74.1) (2022-02-20)

### Bug Fixes

* **flow:** respect defaultJobOptions from queue opts ([#1080](https://github.com/taskforcesh/bullmq/issues/1080)) fixes [#1034](https://github.com/taskforcesh/bullmq/issues/1034) ([0aca072](https://github.com/taskforcesh/bullmq/commit/0aca072f805302e660b6675fd4097ba893c91eb0)) ([`cf0710c`](https://github.com/taskforcesh/bullmq/commit/cf0710cfe322eb2147f439364b425763b4d5c592))

### Documentation

* docs: add queueName doc ([`e52ca41`](https://github.com/taskforcesh/bullmq/commit/e52ca4109eacfec6eb0cddae01952051222ca8eb))

* docs: add queueName doc ([`9c6b331`](https://github.com/taskforcesh/bullmq/commit/9c6b331a84827dc5bdc5a4fd45e89653dfa92079))

### Fix

* fix(flow): respect defaultJobOptions from queue opts (#1080) fixes #1034



* docs(flow): add descriptions of opts param ([`0aca072`](https://github.com/taskforcesh/bullmq/commit/0aca072f805302e660b6675fd4097ba893c91eb0))

### Refactor

* refactor(utils): asyncSend ([`3b3ff30`](https://github.com/taskforcesh/bullmq/commit/3b3ff300f7fa732ea831fe81440c7456518486a4))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`6c2dbb1`](https://github.com/taskforcesh/bullmq/commit/6c2dbb12ebb666bea3de5aed45c413471eee4f4f))


## v1.74.0 (2022-02-19)

### Chore

* chore(release): 1.74.0 [skip ci]

# [1.74.0](https://github.com/taskforcesh/bullmq/compare/v1.73.0...v1.74.0) (2022-02-19)

### Features

* **retry-jobs:** pass timestamp as option ([#1054](https://github.com/taskforcesh/bullmq/issues/1054)) ([1522359](https://github.com/taskforcesh/bullmq/commit/15223590b235f749af9cb229fc784760d4b3add2)) ([`2bf08ef`](https://github.com/taskforcesh/bullmq/commit/2bf08efda8a938e86be2d09ae2dbbdd81b8181b7))

### Documentation

* docs: add obliterateOpts description (#1086) ([`7f7dc34`](https://github.com/taskforcesh/bullmq/commit/7f7dc34789abc8a7fb59dd79a3170c4fb94c202d))

* docs: remove remix from used-by as requested ([`e295ba2`](https://github.com/taskforcesh/bullmq/commit/e295ba2b92e56df8b2bd8e8404b4247dae820673))

### Feature

* feat(retry-jobs): pass timestamp as option (#1054) ([`1522359`](https://github.com/taskforcesh/bullmq/commit/15223590b235f749af9cb229fc784760d4b3add2))


## v1.73.0 (2022-02-16)

### Chore

* chore(release): 1.73.0 [skip ci]

# [1.73.0](https://github.com/taskforcesh/bullmq/compare/v1.72.0...v1.73.0) (2022-02-16)

### Features

* **job:** add prefix getter ([#1077](https://github.com/taskforcesh/bullmq/issues/1077)) ([db9ef10](https://github.com/taskforcesh/bullmq/commit/db9ef105a7a524d7502664d52bd9f9c7dfa9477f))
* **queue-getters:** add getQueueSchedulers ([#1078](https://github.com/taskforcesh/bullmq/issues/1078)) ref [#1075](https://github.com/taskforcesh/bullmq/issues/1075) ([0b3b1c4](https://github.com/taskforcesh/bullmq/commit/0b3b1c4382de34bd68733d162c2fa2ba9417f79c)) ([`19845bd`](https://github.com/taskforcesh/bullmq/commit/19845bd017c3b508aeaa59a50abdf4df0e4dae0f))

### Documentation

* docs(flow): update README.md example description (#1076) ([`ca38bfb`](https://github.com/taskforcesh/bullmq/commit/ca38bfb797ccd37db511d1e02b9a72a42ad4e894))

* docs: add logos for some BullMQ users ([`03949b7`](https://github.com/taskforcesh/bullmq/commit/03949b70b17dc767c113b0fe9ffcbe927553e105))

### Feature

* feat(queue-getters): add getQueueSchedulers (#1078) ref #1075 ([`0b3b1c4`](https://github.com/taskforcesh/bullmq/commit/0b3b1c4382de34bd68733d162c2fa2ba9417f79c))

* feat(job): add prefix getter (#1077) ([`db9ef10`](https://github.com/taskforcesh/bullmq/commit/db9ef105a7a524d7502664d52bd9f9c7dfa9477f))

### Unknown

* GitBook: [#91] No subject ([`12944e6`](https://github.com/taskforcesh/bullmq/commit/12944e615fcf29a4c25f217d55e2d870b7923c73))

* GitBook: [#90] No subject ([`27c9883`](https://github.com/taskforcesh/bullmq/commit/27c9883e7b06252e2903006a9c3efca68e0a3738))

* GitBook: [#89] No subject ([`99d21d1`](https://github.com/taskforcesh/bullmq/commit/99d21d19f37924294c941b1959be46379d6fd6e1))


## v1.72.0 (2022-02-15)

### Chore

* chore(release): 1.72.0 [skip ci]

# [1.72.0](https://github.com/taskforcesh/bullmq/compare/v1.71.0...v1.72.0) (2022-02-15)

### Features

* **backoff:** validate UnrecoverableError presence ([#1074](https://github.com/taskforcesh/bullmq/issues/1074)) ([1defeac](https://github.com/taskforcesh/bullmq/commit/1defeac3f251a13aad57f3027d8eb8f857e40acb)) ([`efe9bb7`](https://github.com/taskforcesh/bullmq/commit/efe9bb7239d9554407e8d0cf40fe74cae83abea5))

### Documentation

* docs(step-jobs): pattern to wait children when adding children at runtime (#1069) ([`d53a800`](https://github.com/taskforcesh/bullmq/commit/d53a800473ac5556211408d526df92aba686fff1))

### Feature

* feat(backoff): validate UnrecoverableError presence (#1074) ([`1defeac`](https://github.com/taskforcesh/bullmq/commit/1defeac3f251a13aad57f3027d8eb8f857e40acb))


## v1.71.0 (2022-02-14)

### Chore

* chore(release): 1.71.0 [skip ci]

# [1.71.0](https://github.com/taskforcesh/bullmq/compare/v1.70.0...v1.71.0) (2022-02-14)

### Features

* **get-job-counts:** add default values ([#1068](https://github.com/taskforcesh/bullmq/issues/1068)) ([1c7f841](https://github.com/taskforcesh/bullmq/commit/1c7f841a52b3ea18fa7878f10986b362ccc6c4fe)) ([`cdb1de2`](https://github.com/taskforcesh/bullmq/commit/cdb1de2fca81df5b18fb3312d821bc1cdae19066))

### Feature

* feat(get-job-counts): add default values (#1068) ([`1c7f841`](https://github.com/taskforcesh/bullmq/commit/1c7f841a52b3ea18fa7878f10986b362ccc6c4fe))

### Refactor

* refactor: extract trimEvents as include (#1071) ([`6ded7ba`](https://github.com/taskforcesh/bullmq/commit/6ded7bae22b0f369ebb68960d48780f547d43346))


## v1.70.0 (2022-02-11)

### Chore

* chore(release): 1.70.0 [skip ci]

# [1.70.0](https://github.com/taskforcesh/bullmq/compare/v1.69.1...v1.70.0) (2022-02-11)

### Features

* **sandbox:** pass parent property ([#1065](https://github.com/taskforcesh/bullmq/issues/1065)) ([1fd33f6](https://github.com/taskforcesh/bullmq/commit/1fd33f6fd3a3af17753de8c4d48e14ef86c7409c)) ([`9cd593f`](https://github.com/taskforcesh/bullmq/commit/9cd593fefc5b08fa13de7d4119327db7202fdd4b))

### Feature

* feat(sandbox): pass parent property (#1065) ([`1fd33f6`](https://github.com/taskforcesh/bullmq/commit/1fd33f6fd3a3af17753de8c4d48e14ef86c7409c))


## v1.69.1 (2022-02-10)

### Chore

* chore(release): 1.69.1 [skip ci]

## [1.69.1](https://github.com/taskforcesh/bullmq/compare/v1.69.0...v1.69.1) (2022-02-10)

### Bug Fixes

* **move-to-finished:** validate lock first ([#1064](https://github.com/taskforcesh/bullmq/issues/1064)) ([9da1b29](https://github.com/taskforcesh/bullmq/commit/9da1b29486c6c6e2b097ec2f6107494a36525495)) ([`8216ce2`](https://github.com/taskforcesh/bullmq/commit/8216ce26c28e79307dc0c4eb3f79c0eb582260b8))

### Fix

* fix(move-to-finished): validate lock first (#1064) ([`9da1b29`](https://github.com/taskforcesh/bullmq/commit/9da1b29486c6c6e2b097ec2f6107494a36525495))

### Refactor

* refactor(move-to-finished): reuse removeJob include (#1061) ([`e48aec6`](https://github.com/taskforcesh/bullmq/commit/e48aec6ced3989995a78c581222c9798a50087eb))


## v1.69.0 (2022-02-08)

### Chore

* chore(release): 1.69.0 [skip ci]

# [1.69.0](https://github.com/taskforcesh/bullmq/compare/v1.68.4...v1.69.0) (2022-02-08)

### Features

* **job:** pass queueName into sandbox ([#1053](https://github.com/taskforcesh/bullmq/issues/1053)) fixes [#1050](https://github.com/taskforcesh/bullmq/issues/1050) ref [#1051](https://github.com/taskforcesh/bullmq/issues/1051) ([12bb19c](https://github.com/taskforcesh/bullmq/commit/12bb19c1586d8755b973a80be97f407630827d4f)) ([`64e01fb`](https://github.com/taskforcesh/bullmq/commit/64e01fbbe9e76c663477ef18e84a37dfd90e667a))

### Feature

* feat(job): pass queueName into sandbox (#1053) fixes #1050 ref #1051 ([`12bb19c`](https://github.com/taskforcesh/bullmq/commit/12bb19c1586d8755b973a80be97f407630827d4f))


## v1.68.4 (2022-02-05)

### Chore

* chore(release): 1.68.4 [skip ci]

## [1.68.4](https://github.com/taskforcesh/bullmq/compare/v1.68.3...v1.68.4) (2022-02-05)

### Bug Fixes

* **clean:** consider checking parent jobs when cleaning ([#1048](https://github.com/taskforcesh/bullmq/issues/1048)) ([0708a24](https://github.com/taskforcesh/bullmq/commit/0708a24c7f4cb6d1cda776ed983d3f20fc3261f1)) ([`8fc4b7e`](https://github.com/taskforcesh/bullmq/commit/8fc4b7e358d8188983eb7c4a714c57d80be2b9b4))

### Fix

* fix(clean): consider checking parent jobs when cleaning (#1048) ([`0708a24`](https://github.com/taskforcesh/bullmq/commit/0708a24c7f4cb6d1cda776ed983d3f20fc3261f1))

### Refactor

* refactor(retry-jobs): create getZSetItems include script (#1052) ([`5ab8525`](https://github.com/taskforcesh/bullmq/commit/5ab85256d1b4e1fad75c86626f03864be0f3cd30))


## v1.68.3 (2022-02-04)

### Chore

* chore(release): 1.68.3 [skip ci]

## [1.68.3](https://github.com/taskforcesh/bullmq/compare/v1.68.2...v1.68.3) (2022-02-04)

### Bug Fixes

* **drain:** delete priority queueKey ([#1049](https://github.com/taskforcesh/bullmq/issues/1049)) ([2e6129a](https://github.com/taskforcesh/bullmq/commit/2e6129a4a08783eeafa2f0b69c10ac810f53d085)) ([`7685091`](https://github.com/taskforcesh/bullmq/commit/76850916ceb3c693b2c7e32549ccd9dde6d374d9))

### Fix

* fix(drain): delete priority queueKey (#1049) ([`2e6129a`](https://github.com/taskforcesh/bullmq/commit/2e6129a4a08783eeafa2f0b69c10ac810f53d085))


## v1.68.2 (2022-02-03)

### Chore

* chore(release): 1.68.2 [skip ci]

## [1.68.2](https://github.com/taskforcesh/bullmq/compare/v1.68.1...v1.68.2) (2022-02-03)

### Performance Improvements

* **remove-parent-dependency:** do not emit wait event in hard deletions ([#1045](https://github.com/taskforcesh/bullmq/issues/1045)) ([4069821](https://github.com/taskforcesh/bullmq/commit/40698218d13a880615f832a9926f0f057b1c33f9)) ([`dfc01bb`](https://github.com/taskforcesh/bullmq/commit/dfc01bb3bedbcc676ffa2f40381477c51b2fd956))

### Documentation

* docs(process-step-jobs): add new pattern (#1044) ([`e988cf5`](https://github.com/taskforcesh/bullmq/commit/e988cf5589783cf3ba7b4785d8b63df632c0fe37))

* docs(flow-job): add description into FlowOpts (#1047) ([`734f5fe`](https://github.com/taskforcesh/bullmq/commit/734f5fe8257a29b7790fa848173f2a1a35cbe605))

* docs(worker): specify error parameter in failed event (#1043) fixes #1038 ([`42114f5`](https://github.com/taskforcesh/bullmq/commit/42114f53058229e24127e0b649f4a7ec5a847b01))

* docs(wait-until-finished): update docs to match behavior (#1033) ref #1031 ([`d3e0d09`](https://github.com/taskforcesh/bullmq/commit/d3e0d09b6147940eb9074c9ee0f53bc3e76670a6))

### Performance

* perf(remove-parent-dependency): do not emit wait event in hard deletions (#1045) ([`4069821`](https://github.com/taskforcesh/bullmq/commit/40698218d13a880615f832a9926f0f057b1c33f9))


## v1.68.1 (2022-02-01)

### Chore

* chore(release): 1.68.1 [skip ci]

## [1.68.1](https://github.com/taskforcesh/bullmq/compare/v1.68.0...v1.68.1) (2022-02-01)

### Bug Fixes

* **update:** throw error when missing job key ([#1042](https://github.com/taskforcesh/bullmq/issues/1042)) ([a00ae5c](https://github.com/taskforcesh/bullmq/commit/a00ae5c9b3f6d51cb0229adca29d13d932fc5601)) ([`2c2da6f`](https://github.com/taskforcesh/bullmq/commit/2c2da6ffa0744447f7cad9760cc0ff7f7d13c0e7))

### Fix

* fix(update): throw error when missing job key (#1042) ([`a00ae5c`](https://github.com/taskforcesh/bullmq/commit/a00ae5c9b3f6d51cb0229adca29d13d932fc5601))


## v1.68.0 (2022-01-29)

### Chore

* chore(release): 1.68.0 [skip ci]

# [1.68.0](https://github.com/taskforcesh/bullmq/compare/v1.67.3...v1.68.0) (2022-01-29)

### Features

* **queue:** add retryJobs method for failed jobs ([#1024](https://github.com/taskforcesh/bullmq/issues/1024)) ([310a730](https://github.com/taskforcesh/bullmq/commit/310a730ed322501cc19cdd5cf5244bc8eee6fee2))

### Performance Improvements

* **lua:** call del command with multiple keys ([#1035](https://github.com/taskforcesh/bullmq/issues/1035)) ([9cfaab8](https://github.com/taskforcesh/bullmq/commit/9cfaab8965d0c9f92460d31d6c3083839c36447f)) ([`317c095`](https://github.com/taskforcesh/bullmq/commit/317c0953043e3eb2242eb330d8e8e2071c131c37))

### Feature

* feat(queue): add retryJobs method for failed jobs (#1024) ([`310a730`](https://github.com/taskforcesh/bullmq/commit/310a730ed322501cc19cdd5cf5244bc8eee6fee2))

### Performance

* perf(lua): call del command with multiple keys (#1035) ([`9cfaab8`](https://github.com/taskforcesh/bullmq/commit/9cfaab8965d0c9f92460d31d6c3083839c36447f))


## v1.67.3 (2022-01-28)

### Chore

* chore(release): 1.67.3 [skip ci]

## [1.67.3](https://github.com/taskforcesh/bullmq/compare/v1.67.2...v1.67.3) (2022-01-28)

### Bug Fixes

* **drain:** consider checking parent jobs when draining ([#992](https://github.com/taskforcesh/bullmq/issues/992)) ([81b7221](https://github.com/taskforcesh/bullmq/commit/81b72213a9ff31d6b297825391de77557598ebd1)) ([`e45a0f7`](https://github.com/taskforcesh/bullmq/commit/e45a0f7e18b28385022eaafd678fbe5edb82eb4f))

### Fix

* fix(drain): consider checking parent jobs when draining (#992) ([`81b7221`](https://github.com/taskforcesh/bullmq/commit/81b72213a9ff31d6b297825391de77557598ebd1))


## v1.67.2 (2022-01-28)

### Chore

* chore(release): 1.67.2 [skip ci]

## [1.67.2](https://github.com/taskforcesh/bullmq/compare/v1.67.1...v1.67.2) (2022-01-28)

### Bug Fixes

* **repeat:** consider immediately option with cron ([#1030](https://github.com/taskforcesh/bullmq/issues/1030)) fixes [#1020](https://github.com/taskforcesh/bullmq/issues/1020) ([b9e7488](https://github.com/taskforcesh/bullmq/commit/b9e748870385a88b2384df40f50df3144c11d7e0)) ([`e55ff35`](https://github.com/taskforcesh/bullmq/commit/e55ff358ca23bb4ea3d70bfb136feb27be3fe79c))

### Fix

* fix(repeat): consider immediately option with cron (#1030) fixes #1020 ([`b9e7488`](https://github.com/taskforcesh/bullmq/commit/b9e748870385a88b2384df40f50df3144c11d7e0))

### Test

* test: pass shared connection into Queue in test case (#1029) ([`da587c2`](https://github.com/taskforcesh/bullmq/commit/da587c2844763a5e7035f799541ce0d6e09aa296))


## v1.67.1 (2022-01-27)

### Chore

* chore(release): 1.67.1 [skip ci]

## [1.67.1](https://github.com/taskforcesh/bullmq/compare/v1.67.0...v1.67.1) (2022-01-27)

### Bug Fixes

* **retry:** pass state in error message ([#1027](https://github.com/taskforcesh/bullmq/issues/1027)) ([c646a45](https://github.com/taskforcesh/bullmq/commit/c646a45377fdfaff340185d1f7bedceb80c214c2))

### Performance Improvements

* **retry:** delete props in retryJob lua script ([#1016](https://github.com/taskforcesh/bullmq/issues/1016)) ([547cedd](https://github.com/taskforcesh/bullmq/commit/547cedd5ecd30c9a73d37e4053b9e518cb3fbe53)) ([`a440be9`](https://github.com/taskforcesh/bullmq/commit/a440be95518ebf037a5879decad282249e651180))

### Fix

* fix(retry): pass state in error message (#1027) ([`c646a45`](https://github.com/taskforcesh/bullmq/commit/c646a45377fdfaff340185d1f7bedceb80c214c2))

### Performance

* perf(retry): delete props in retryJob lua script (#1016) ([`547cedd`](https://github.com/taskforcesh/bullmq/commit/547cedd5ecd30c9a73d37e4053b9e518cb3fbe53))


## v1.67.0 (2022-01-26)

### Chore

* chore(release): 1.67.0 [skip ci]

# [1.67.0](https://github.com/taskforcesh/bullmq/compare/v1.66.1...v1.67.0) (2022-01-26)

### Features

* add support for removeOn based on time ([6c4ac75](https://github.com/taskforcesh/bullmq/commit/6c4ac75bb3ac239cc83ef6144d69c04b2bba1311)) ([`8c5fcea`](https://github.com/taskforcesh/bullmq/commit/8c5fcea765682e7d3d3e189a89217ed5d7838da8))

* chore: move helper close to tests ([`4dca8ed`](https://github.com/taskforcesh/bullmq/commit/4dca8ed5f3dd0e8f3ac79c80f32cbc1628c04f79))

### Feature

* feat: add support for removeOn based on time ([`6c4ac75`](https://github.com/taskforcesh/bullmq/commit/6c4ac75bb3ac239cc83ef6144d69c04b2bba1311))

### Test

* test: skip compat tests as they are deprecated ([`17fee4e`](https://github.com/taskforcesh/bullmq/commit/17fee4e3a16535ea7556fdb2e242c6cb36a56843))


## v1.66.1 (2022-01-25)

### Chore

* chore(release): 1.66.1 [skip ci]

## [1.66.1](https://github.com/taskforcesh/bullmq/compare/v1.66.0...v1.66.1) (2022-01-25)

### Bug Fixes

* **job:** increase attemptsMade when moving job to active ([#1009](https://github.com/taskforcesh/bullmq/issues/1009)) fixes [#1002](https://github.com/taskforcesh/bullmq/issues/1002) ([0974ae0](https://github.com/taskforcesh/bullmq/commit/0974ae0ff6db73c223be4b18fb2aab53b6a23c88)) ([`30a9bc6`](https://github.com/taskforcesh/bullmq/commit/30a9bc6c3b719c469396c80f14e8249d7e7ce85b))

* chore(deps): bump node-fetch from 2.6.1 to 2.6.7 (#1014) ([`07735a0`](https://github.com/taskforcesh/bullmq/commit/07735a01b090c435e3e9ed27a3c41957632545ba))

### Fix

* fix(job): increase attemptsMade when moving job to active (#1009) fixes #1002 ([`0974ae0`](https://github.com/taskforcesh/bullmq/commit/0974ae0ff6db73c223be4b18fb2aab53b6a23c88))


## v1.66.0 (2022-01-23)

### Chore

* chore(release): 1.66.0 [skip ci]

# [1.66.0](https://github.com/taskforcesh/bullmq/compare/v1.65.1...v1.66.0) (2022-01-23)

### Features

* **queue-events:** add retries-exhausted event ([#1010](https://github.com/taskforcesh/bullmq/issues/1010)) ([e476f35](https://github.com/taskforcesh/bullmq/commit/e476f35f5c3f9b1baf2bbc3d46712b8ba597f73c)) ([`9945a03`](https://github.com/taskforcesh/bullmq/commit/9945a03b0b3673c1cf981573b2b8669f0e4026c5))

### Feature

* feat(queue-events): add retries-exhausted event (#1010) ([`e476f35`](https://github.com/taskforcesh/bullmq/commit/e476f35f5c3f9b1baf2bbc3d46712b8ba597f73c))


## v1.65.1 (2022-01-21)

### Chore

* chore(release): 1.65.1 [skip ci]

## [1.65.1](https://github.com/taskforcesh/bullmq/compare/v1.65.0...v1.65.1) (2022-01-21)

### Bug Fixes

* dont loop through empty modules paths ([#1013](https://github.com/taskforcesh/bullmq/issues/1013)) fixes [#1012](https://github.com/taskforcesh/bullmq/issues/1012) ([86e84df](https://github.com/taskforcesh/bullmq/commit/86e84df933c2662380b00a11b5f4000f2618d218)) ([`3677295`](https://github.com/taskforcesh/bullmq/commit/36772957fcf865e8fd7dba92d594f8800c4b1e6f))

### Fix

* fix: dont loop through empty modules paths (#1013) fixes #1012 ([`86e84df`](https://github.com/taskforcesh/bullmq/commit/86e84df933c2662380b00a11b5f4000f2618d218))


## v1.65.0 (2022-01-21)

### Chore

* chore(release): 1.65.0 [skip ci]

# [1.65.0](https://github.com/taskforcesh/bullmq/compare/v1.64.4...v1.65.0) (2022-01-21)

### Features

* **queue:** add JobType and JobState unions for better typing ([#1011](https://github.com/taskforcesh/bullmq/issues/1011)) ([3b9b79d](https://github.com/taskforcesh/bullmq/commit/3b9b79dbdd754ab66c3948e7e16380f2d5513262)) ([`7f0245d`](https://github.com/taskforcesh/bullmq/commit/7f0245dce512e30e33559df219af3c227a6228e4))

* chore(deps): bump trim-off-newlines from 1.0.1 to 1.0.3 (#1008) ([`2dfb7ae`](https://github.com/taskforcesh/bullmq/commit/2dfb7aef39c0f7699a030298a377658bb9acda6b))

### Feature

* feat(queue): add JobType and JobState unions for better typing (#1011) ([`3b9b79d`](https://github.com/taskforcesh/bullmq/commit/3b9b79dbdd754ab66c3948e7e16380f2d5513262))


## v1.64.4 (2022-01-19)

### Chore

* chore(release): 1.64.4 [skip ci]

## [1.64.4](https://github.com/taskforcesh/bullmq/compare/v1.64.3...v1.64.4) (2022-01-19)

### Bug Fixes

* **queue:** use 0 as initial value for getJobCountByTypes reducer ([#1005](https://github.com/taskforcesh/bullmq/issues/1005)) ([f0e23ef](https://github.com/taskforcesh/bullmq/commit/f0e23ef01b97d36c775db0bf8c9dd2f63f6cb194)) ([`43ea8c5`](https://github.com/taskforcesh/bullmq/commit/43ea8c5a6a1cff364c00e3a0a1bc9dae92ab469f))

### Ci

* ci(redis): run tests in different redis versions (#999) ([`8c22da5`](https://github.com/taskforcesh/bullmq/commit/8c22da5c1225ba090ab0f7af063b05b1f69c69ce))

### Documentation

* docs(job): add params docs in waitUntilFinished (#1000) ref #996 ([`32e7948`](https://github.com/taskforcesh/bullmq/commit/32e7948408f6e12bfe913db1d7c3be7cabb0a5ef))

### Fix

* fix(queue): use 0 as initial value for getJobCountByTypes reducer (#1005) ([`f0e23ef`](https://github.com/taskforcesh/bullmq/commit/f0e23ef01b97d36c775db0bf8c9dd2f63f6cb194))

### Unknown

* GitBook: [#88] No subject ([`a565666`](https://github.com/taskforcesh/bullmq/commit/a565666f199b47dfb92216334646e8ea68f590ee))

* GitBook: [#87] No subject ([`92f9681`](https://github.com/taskforcesh/bullmq/commit/92f968198274f97406eaa4324f65dc945ba8fb12))

* GitBook: [#86] No subject ([`8ce484a`](https://github.com/taskforcesh/bullmq/commit/8ce484a58000d1ba5036806b0f6968f96ffa1170))


## v1.64.3 (2022-01-17)

### Chore

* chore(release): 1.64.3 [skip ci]

## [1.64.3](https://github.com/taskforcesh/bullmq/compare/v1.64.2...v1.64.3) (2022-01-17)

### Bug Fixes

* **worker:** blockTime must be integer on older Redis ([6fedc0a](https://github.com/taskforcesh/bullmq/commit/6fedc0a03bdb217ef0dbae60d49fccb0f2a5dbdb)) ([`70001de`](https://github.com/taskforcesh/bullmq/commit/70001de2c4c039bf9448a5cc25037f517fd25915))

### Documentation

* docs(readme): add Bullmq-Pro in comparison table (#993) ([`9d35cb4`](https://github.com/taskforcesh/bullmq/commit/9d35cb49ac6f4172f13832e136fc68cd22426491))

### Fix

* fix(worker): blockTime must be integer on older Redis ([`6fedc0a`](https://github.com/taskforcesh/bullmq/commit/6fedc0a03bdb217ef0dbae60d49fccb0f2a5dbdb))


## v1.64.2 (2022-01-14)

### Chore

* chore(release): 1.64.2 [skip ci]

## [1.64.2](https://github.com/taskforcesh/bullmq/compare/v1.64.1...v1.64.2) (2022-01-14)

### Bug Fixes

* **remove-job:** consider removing parent dependency key in lua scripts ([#990](https://github.com/taskforcesh/bullmq/issues/990)) ([661abf0](https://github.com/taskforcesh/bullmq/commit/661abf0921e663c9ea2fa7d59c12da35950637dc)) ([`1791390`](https://github.com/taskforcesh/bullmq/commit/17913908c816cfa480a34a80bb13eb16db455168))

### Fix

* fix(remove-job): consider removing parent dependency key in lua scripts (#990) ([`661abf0`](https://github.com/taskforcesh/bullmq/commit/661abf0921e663c9ea2fa7d59c12da35950637dc))


## v1.64.1 (2022-01-14)

### Chore

* chore(release): 1.64.1 [skip ci]

## [1.64.1](https://github.com/taskforcesh/bullmq/compare/v1.64.0...v1.64.1) (2022-01-14)

### Bug Fixes

* **sandbox:** exit uncaughtException instead of throwing error ([013d6a5](https://github.com/taskforcesh/bullmq/commit/013d6a5ee0c70266ae740abfa596ca9e506de71b)) ([`aea20b4`](https://github.com/taskforcesh/bullmq/commit/aea20b48af275a2ab3fb9b3f3234af8ca4ce76bc))

* chore: update docker-compose config (#986) ([`21c5a51`](https://github.com/taskforcesh/bullmq/commit/21c5a51680527fea0845f87151bca34054ce29af))

### Fix

* fix(sandbox): exit uncaughtException instead of throwing error ([`013d6a5`](https://github.com/taskforcesh/bullmq/commit/013d6a5ee0c70266ae740abfa596ca9e506de71b))

### Unknown

* GitBook: [#85] No subject ([`3cae7c3`](https://github.com/taskforcesh/bullmq/commit/3cae7c3e44be2ca075d0aa6363be79636e607786))


## v1.64.0 (2022-01-07)

### Chore

* chore(release): 1.64.0 [skip ci]

# [1.64.0](https://github.com/taskforcesh/bullmq/compare/v1.63.3...v1.64.0) (2022-01-07)

### Features

* **sanboxed-process:** support .cjs files ([#984](https://github.com/taskforcesh/bullmq/issues/984)) ([531e4de](https://github.com/taskforcesh/bullmq/commit/531e4de1525f2cf322e0b97f5537ed43276ff72b)) ([`b918676`](https://github.com/taskforcesh/bullmq/commit/b91867653564a97a5ced04f36dac1a4e1c96e21b))

### Feature

* feat(sanboxed-process): support .cjs files (#984) ([`531e4de`](https://github.com/taskforcesh/bullmq/commit/531e4de1525f2cf322e0b97f5537ed43276ff72b))


## v1.63.3 (2022-01-06)

### Chore

* chore(release): 1.63.3 [skip ci]

## [1.63.3](https://github.com/taskforcesh/bullmq/compare/v1.63.2...v1.63.3) (2022-01-06)

### Bug Fixes

* **job:** throw error when delay and repeat are provided together ([#983](https://github.com/taskforcesh/bullmq/issues/983)) ([07b0082](https://github.com/taskforcesh/bullmq/commit/07b008273ead9360fc43564fa9ff1a7503616ceb)) ([`282a402`](https://github.com/taskforcesh/bullmq/commit/282a4029bc9985056508f83deb5040b830dc3c82))

* chore(scripts): add generics in methods (#981) ([`8807b5e`](https://github.com/taskforcesh/bullmq/commit/8807b5eef1114dd866060b1f9571675fc3e1a36d))

### Fix

* fix(job): throw error when delay and repeat are provided together (#983) ([`07b0082`](https://github.com/taskforcesh/bullmq/commit/07b008273ead9360fc43564fa9ff1a7503616ceb))


## v1.63.2 (2022-01-04)

### Chore

* chore(release): 1.63.2 [skip ci]

## [1.63.2](https://github.com/taskforcesh/bullmq/compare/v1.63.1...v1.63.2) (2022-01-04)

### Bug Fixes

* **queue:** add missing error event typing ([#979](https://github.com/taskforcesh/bullmq/issues/979)) ([afdaac6](https://github.com/taskforcesh/bullmq/commit/afdaac6b072c7af5973222cc7fb69f3f138f3b0b)) ([`1f3b1cb`](https://github.com/taskforcesh/bullmq/commit/1f3b1cb0fe1857a6cc4581611f8aeda371d04f2e))

### Documentation

* docs: delete duplicated parent-child explanation (#980) ([`9fb8b72`](https://github.com/taskforcesh/bullmq/commit/9fb8b72885bab40e3980418a6367859435397733))

### Fix

* fix(queue): add missing error event typing (#979) ([`afdaac6`](https://github.com/taskforcesh/bullmq/commit/afdaac6b072c7af5973222cc7fb69f3f138f3b0b))


## v1.63.1 (2022-01-04)

### Chore

* chore(release): 1.63.1 [skip ci]

## [1.63.1](https://github.com/taskforcesh/bullmq/compare/v1.63.0...v1.63.1) (2022-01-04)

### Bug Fixes

* **update-progress:** throw error if job key is missing ([#978](https://github.com/taskforcesh/bullmq/issues/978)) ref [#977](https://github.com/taskforcesh/bullmq/issues/977) ([b03aaf1](https://github.com/taskforcesh/bullmq/commit/b03aaf10ca694745d143def2129f952b9bac18a6)) ([`1763af8`](https://github.com/taskforcesh/bullmq/commit/1763af8eb35fe5b48cbe1a6a1a066524edb59232))

### Fix

* fix(update-progress): throw error if job key is missing (#978) ref #977 ([`b03aaf1`](https://github.com/taskforcesh/bullmq/commit/b03aaf10ca694745d143def2129f952b9bac18a6))


## v1.63.0 (2021-12-31)

### Chore

* chore(release): 1.63.0 [skip ci]

# [1.63.0](https://github.com/taskforcesh/bullmq/compare/v1.62.0...v1.63.0) (2021-12-31)

### Features

* **job:** use generic types for static methods ([#975](https://github.com/taskforcesh/bullmq/issues/975)) ([f78f4d0](https://github.com/taskforcesh/bullmq/commit/f78f4d0f75adb5c73558b3e8cf511db22f972791)) ([`4cfa4f9`](https://github.com/taskforcesh/bullmq/commit/4cfa4f9c0d97a29b89ab342a5f41de5e4e3ecbd2))

### Documentation

* docs(flow): add getFlow into guide structure (#976) ([`db1224a`](https://github.com/taskforcesh/bullmq/commit/db1224a6aa674288b7ad879f53c9e1e063b7e9f7))

### Feature

* feat(job): use generic types for static methods (#975) ([`f78f4d0`](https://github.com/taskforcesh/bullmq/commit/f78f4d0f75adb5c73558b3e8cf511db22f972791))

### Refactor

* refactor: clean some interfaces references (#974) ([`92da59e`](https://github.com/taskforcesh/bullmq/commit/92da59ec7e9932377cb1b6a2ba1422ec50e24158))


## v1.62.0 (2021-12-31)

### Chore

* chore(release): 1.62.0 [skip ci]

# [1.62.0](https://github.com/taskforcesh/bullmq/compare/v1.61.0...v1.62.0) (2021-12-31)

### Bug Fixes

* add deprecated tag in progress and Queue3 class ([#973](https://github.com/taskforcesh/bullmq/issues/973)) ([6abdf5b](https://github.com/taskforcesh/bullmq/commit/6abdf5b66717cc8bc8ddb048029f7d9b92509942))

### Features

* **queue:** add better event typing ([#971](https://github.com/taskforcesh/bullmq/issues/971)) ([596fd7b](https://github.com/taskforcesh/bullmq/commit/596fd7b260f2e95607f0eb4ff9553fb35137ec54)) ([`abe3f59`](https://github.com/taskforcesh/bullmq/commit/abe3f594b412c924ae9eb42e450bd2a356df7654))

### Feature

* feat(queue): add better event typing (#971) ([`596fd7b`](https://github.com/taskforcesh/bullmq/commit/596fd7b260f2e95607f0eb4ff9553fb35137ec54))

### Fix

* fix: add deprecated tag in progress and Queue3 class (#973) ([`6abdf5b`](https://github.com/taskforcesh/bullmq/commit/6abdf5b66717cc8bc8ddb048029f7d9b92509942))


## v1.61.0 (2021-12-29)

### Chore

* chore(release): 1.61.0 [skip ci]

# [1.61.0](https://github.com/taskforcesh/bullmq/compare/v1.60.0...v1.61.0) (2021-12-29)

### Features

* **queue:** reuse generic typing for jobs ([5c10818](https://github.com/taskforcesh/bullmq/commit/5c10818d90724cccdf510f0358c01233aeac77e4))
* **worker:** reuse generic typing for jobs ([9adcdb7](https://github.com/taskforcesh/bullmq/commit/9adcdb798b4ee55835123a9f3d04c1397b176dc1)) ([`06176e3`](https://github.com/taskforcesh/bullmq/commit/06176e32579611f06569a9e05a26832c02a0e6f4))

### Feature

* feat(queue): reuse generic typing for jobs ([`5c10818`](https://github.com/taskforcesh/bullmq/commit/5c10818d90724cccdf510f0358c01233aeac77e4))

* feat(worker): reuse generic typing for jobs ([`9adcdb7`](https://github.com/taskforcesh/bullmq/commit/9adcdb798b4ee55835123a9f3d04c1397b176dc1))


## v1.60.0 (2021-12-29)

### Chore

* chore(release): 1.60.0 [skip ci]

# [1.60.0](https://github.com/taskforcesh/bullmq/compare/v1.59.4...v1.60.0) (2021-12-29)

### Features

* **queue-scheduler:** add better event typing ([#963](https://github.com/taskforcesh/bullmq/issues/963)) ([b23c006](https://github.com/taskforcesh/bullmq/commit/b23c006e2bfce8a0709f0eb8e8739261b68c2f48)) ([`0caa042`](https://github.com/taskforcesh/bullmq/commit/0caa042725325a5b682d9ce53a5346a1131486a2))

### Documentation

* docs(throttle-jobs): fix definition in patterns (#961) fixes #689 ([`e184d4d`](https://github.com/taskforcesh/bullmq/commit/e184d4d88c37f1e9b2d3c4fddf00130556a9f8df))

### Feature

* feat(queue-scheduler): add better event typing (#963) ([`b23c006`](https://github.com/taskforcesh/bullmq/commit/b23c006e2bfce8a0709f0eb8e8739261b68c2f48))

### Refactor

* refactor(get-state): add checkItemInList include (#964) ([`9df25c1`](https://github.com/taskforcesh/bullmq/commit/9df25c1f1310186e0516e0bb02abba527a819480))

### Test

* test(worker): add case when sharing connection (#955) ([`2325ff7`](https://github.com/taskforcesh/bullmq/commit/2325ff791aae19cd98f8d27b645afade07b4c4fc))

* test: add next tick into processor (#967) ([`c636528`](https://github.com/taskforcesh/bullmq/commit/c636528d07161ed68ad017a65867aa1c9172c5d5))

* test(repeat): call nextTick in processor (#966) ([`2aaae88`](https://github.com/taskforcesh/bullmq/commit/2aaae88b58def78718e13ceea1a3ec9ab069b69b))


## v1.59.4 (2021-12-21)

### Chore

* chore(release): 1.59.4 [skip ci]

## [1.59.4](https://github.com/taskforcesh/bullmq/compare/v1.59.3...v1.59.4) (2021-12-21)

### Bug Fixes

* downgrade typescript to 3.9.10 fixes [#917](https://github.com/taskforcesh/bullmq/issues/917) ([#960](https://github.com/taskforcesh/bullmq/issues/960)) ([4e51fe0](https://github.com/taskforcesh/bullmq/commit/4e51fe00751092ee8f521039a3f2b41d881b71ae)) ([`fbecbef`](https://github.com/taskforcesh/bullmq/commit/fbecbef96a2f8b7d037d8ffaca7c0f710be9b518))

### Fix

* fix: downgrade typescript to 3.9.10 fixes #917 (#960) ([`4e51fe0`](https://github.com/taskforcesh/bullmq/commit/4e51fe00751092ee8f521039a3f2b41d881b71ae))


## v1.59.3 (2021-12-21)

### Chore

* chore(release): 1.59.3 [skip ci]

## [1.59.3](https://github.com/taskforcesh/bullmq/compare/v1.59.2...v1.59.3) (2021-12-21)

### Bug Fixes

* **worker:** fix undefined moveToActive ([87e8cab](https://github.com/taskforcesh/bullmq/commit/87e8cab16dad6f8bd9e9ec369ef7e79f471180be)) ([`28ccfa9`](https://github.com/taskforcesh/bullmq/commit/28ccfa91f9fac99abd6f2d448d7f2e8d10b78806))

### Fix

* fix(worker): fix undefined moveToActive ([`87e8cab`](https://github.com/taskforcesh/bullmq/commit/87e8cab16dad6f8bd9e9ec369ef7e79f471180be))


## v1.59.2 (2021-12-17)

### Chore

* chore(release): 1.59.2 [skip ci]

## [1.59.2](https://github.com/taskforcesh/bullmq/compare/v1.59.1...v1.59.2) (2021-12-17)

### Bug Fixes

* **package:** add jsnext:main prop ([#953](https://github.com/taskforcesh/bullmq/issues/953)) ([1a92bf7](https://github.com/taskforcesh/bullmq/commit/1a92bf7d41860f758841c5a833c1192d9a84a25f)) ([`7a950f5`](https://github.com/taskforcesh/bullmq/commit/7a950f5b336702f79058952c14bb2bf573818158))

### Documentation

* docs: update debounce-jobs.md (#950) ([`424b54a`](https://github.com/taskforcesh/bullmq/commit/424b54af7c549150197a647fe898c67ff9d87aa4))

### Fix

* fix(package): add jsnext:main prop (#953) ([`1a92bf7`](https://github.com/taskforcesh/bullmq/commit/1a92bf7d41860f758841c5a833c1192d9a84a25f))


## v1.59.1 (2021-12-17)

### Chore

* chore(release): 1.59.1 [skip ci]

## [1.59.1](https://github.com/taskforcesh/bullmq/compare/v1.59.0...v1.59.1) (2021-12-17)

### Bug Fixes

* copy lua files to correct location ([2be1120](https://github.com/taskforcesh/bullmq/commit/2be1120974692ee57ec00e30d6dbbef670d88a1e)) ([`192f093`](https://github.com/taskforcesh/bullmq/commit/192f093af11f0faf6ae946c4a464059d6e48c015))

### Fix

* fix: copy lua files to correct location ([`2be1120`](https://github.com/taskforcesh/bullmq/commit/2be1120974692ee57ec00e30d6dbbef670d88a1e))


## v1.59.0 (2021-12-17)

### Chore

* chore(release): 1.59.0 [skip ci]

# [1.59.0](https://github.com/taskforcesh/bullmq/compare/v1.58.0...v1.59.0) (2021-12-17)

### Bug Fixes

* correct dist path ([067d4c2](https://github.com/taskforcesh/bullmq/commit/067d4c2009b877f8bf6e6145507a41a53e5f7af3))

### Features

* also export bullmq as an ESM ([e97e5b5](https://github.com/taskforcesh/bullmq/commit/e97e5b52b079adf2ed79f7cb61699e40a91e34e8)) ([`0d3a222`](https://github.com/taskforcesh/bullmq/commit/0d3a222859b8b66dbe0aad8c8475b31c4fac93d2))

### Feature

* feat: also export bullmq as an ESM ([`e97e5b5`](https://github.com/taskforcesh/bullmq/commit/e97e5b52b079adf2ed79f7cb61699e40a91e34e8))

### Fix

* fix: correct dist path ([`067d4c2`](https://github.com/taskforcesh/bullmq/commit/067d4c2009b877f8bf6e6145507a41a53e5f7af3))


## v1.58.0 (2021-12-15)

### Chore

* chore(release): 1.58.0 [skip ci]

# [1.58.0](https://github.com/taskforcesh/bullmq/compare/v1.57.4...v1.58.0) (2021-12-15)

### Features

* **worker:** add better event typing ([#940](https://github.com/taskforcesh/bullmq/issues/940)) ([a326d4f](https://github.com/taskforcesh/bullmq/commit/a326d4f27e96ffa462a908ac14356d29839ff073)) ([`e2ffaaf`](https://github.com/taskforcesh/bullmq/commit/e2ffaafc54df02e9a9d7d0cd7e110407753c1ba9))

### Feature

* feat(worker): add better event typing (#940) ([`a326d4f`](https://github.com/taskforcesh/bullmq/commit/a326d4f27e96ffa462a908ac14356d29839ff073))

### Refactor

* refactor(repeat): move removeRepeatable to Script (#939) ([`60ed941`](https://github.com/taskforcesh/bullmq/commit/60ed941a69b6de3d29f29214133c542268d41984))


## v1.57.4 (2021-12-14)

### Chore

* chore(release): 1.57.4 [skip ci]

## [1.57.4](https://github.com/taskforcesh/bullmq/compare/v1.57.3...v1.57.4) (2021-12-14)

### Bug Fixes

* **move-to-active:** add try catch in moveToActive call ([#933](https://github.com/taskforcesh/bullmq/issues/933)) ([bab45b0](https://github.com/taskforcesh/bullmq/commit/bab45b05d08c625557e2df65921e12f48081d39c))
* **redis-connection:** consider cluster redisOptions config ([#934](https://github.com/taskforcesh/bullmq/issues/934)) ([5130f63](https://github.com/taskforcesh/bullmq/commit/5130f63ad969efa9649ab8f9abf36a72e8f553f4)) ([`9d2d62c`](https://github.com/taskforcesh/bullmq/commit/9d2d62c2c33b981ac5071d7122cd50da1d272d5c))

* chore: delete extra test directory (#931) ([`9ccc200`](https://github.com/taskforcesh/bullmq/commit/9ccc200bf26a60523cda85871cf1743fc288cb66))

### Fix

* fix(redis-connection): consider cluster redisOptions config (#934) ([`5130f63`](https://github.com/taskforcesh/bullmq/commit/5130f63ad969efa9649ab8f9abf36a72e8f553f4))

* fix(move-to-active): add try catch in moveToActive call (#933) ([`bab45b0`](https://github.com/taskforcesh/bullmq/commit/bab45b05d08c625557e2df65921e12f48081d39c))


## v1.57.3 (2021-12-14)

### Chore

* chore(release): 1.57.3 [skip ci]

## [1.57.3](https://github.com/taskforcesh/bullmq/compare/v1.57.2...v1.57.3) (2021-12-14)

### Bug Fixes

* remove debug console.error ([#932](https://github.com/taskforcesh/bullmq/issues/932)) ([271aac3](https://github.com/taskforcesh/bullmq/commit/271aac3417bc7f76ac02435b456552677b2847db)) ([`cf57730`](https://github.com/taskforcesh/bullmq/commit/cf57730ae41fb9d6185a78ec47f4ae95aa8dcd88))

### Fix

* fix: remove debug console.error (#932) ([`271aac3`](https://github.com/taskforcesh/bullmq/commit/271aac3417bc7f76ac02435b456552677b2847db))

### Unknown

* GitBook: [#83] docs: add initial documentation for groups rate limiting ([`4b59d05`](https://github.com/taskforcesh/bullmq/commit/4b59d05276a6c1933097542b22fd028b1a7c8a40))


## v1.57.2 (2021-12-11)

### Chore

* chore(release): 1.57.2 [skip ci]

## [1.57.2](https://github.com/taskforcesh/bullmq/compare/v1.57.1...v1.57.2) (2021-12-11)

### Bug Fixes

* **connection:** check instance options to console log deprecation message ([#927](https://github.com/taskforcesh/bullmq/issues/927)) ([fc1e2b9](https://github.com/taskforcesh/bullmq/commit/fc1e2b9f3f20db53f9dc7ecdfa4644f02acc9f83))

### Performance Improvements

* **add-job:** save parent data as json ([#859](https://github.com/taskforcesh/bullmq/issues/859)) ([556d4ee](https://github.com/taskforcesh/bullmq/commit/556d4ee427090f60270945a7fd438e2595bb43e9)) ([`d9fd74f`](https://github.com/taskforcesh/bullmq/commit/d9fd74f8eae499ce2aeb02c7a0e5fcae5e4795bd))

### Fix

* fix(connection): check instance options to console log deprecation message (#927) ([`fc1e2b9`](https://github.com/taskforcesh/bullmq/commit/fc1e2b9f3f20db53f9dc7ecdfa4644f02acc9f83))

### Performance

* perf(add-job): save parent data as json (#859) ([`556d4ee`](https://github.com/taskforcesh/bullmq/commit/556d4ee427090f60270945a7fd438e2595bb43e9))


## v1.57.1 (2021-12-11)

### Chore

* chore(release): 1.57.1 [skip ci]

## [1.57.1](https://github.com/taskforcesh/bullmq/compare/v1.57.0...v1.57.1) (2021-12-11)

### Bug Fixes

* **worker:** better handling of block timeout ([be4c933](https://github.com/taskforcesh/bullmq/commit/be4c933ae0a7a790d24a081b2ed4e7e1c0216e47)) ([`8aa6e36`](https://github.com/taskforcesh/bullmq/commit/8aa6e36a806f51903620d397f821ef55763c6ff4))

### Fix

* fix(worker): better handling of block timeout ([`be4c933`](https://github.com/taskforcesh/bullmq/commit/be4c933ae0a7a790d24a081b2ed4e7e1c0216e47))


## v1.57.0 (2021-12-08)

### Chore

* chore(release): 1.57.0 [skip ci]

# [1.57.0](https://github.com/taskforcesh/bullmq/compare/v1.56.0...v1.57.0) (2021-12-08)

### Features

* **queue-events:** add better event typing ([#919](https://github.com/taskforcesh/bullmq/issues/919)) ([e980080](https://github.com/taskforcesh/bullmq/commit/e980080767bc56ae09a5c5cf33728a85a023bb42)) ([`7ea381b`](https://github.com/taskforcesh/bullmq/commit/7ea381b2936b93d86752e5f4b773fa04b3d8a7cd))

### Feature

* feat(queue-events): add better event typing (#919) ([`e980080`](https://github.com/taskforcesh/bullmq/commit/e980080767bc56ae09a5c5cf33728a85a023bb42))

### Unknown

* GitBook: [#82] docs: fixe import for bullmq-pro ([`efb627b`](https://github.com/taskforcesh/bullmq/commit/efb627b4061b386cbfddecdf638a6e73d3a2820a))


## v1.56.0 (2021-12-06)

### Chore

* chore(release): 1.56.0 [skip ci]

# [1.56.0](https://github.com/taskforcesh/bullmq/compare/v1.55.1...v1.56.0) (2021-12-06)

### Bug Fixes

* emit drain event if no jobs left when completing ([9ad78a9](https://github.com/taskforcesh/bullmq/commit/9ad78a91c0a4a74cf84bd77d351d98195104f0b6))
* **worker:** use client for setting worker name ([af65c2c](https://github.com/taskforcesh/bullmq/commit/af65c2cd0d3fb232c617b018d4991f3276db11ea))

### Features

* **worker:** make moveToActive protected ([d2897ee](https://github.com/taskforcesh/bullmq/commit/d2897ee7bbf4aee5251ac4fb28705f2bebbe7bfe)) ([`bf37a32`](https://github.com/taskforcesh/bullmq/commit/bf37a324273dd1a2f606ff2dcb08c6166cc86ae9))

* chore: refactor moveToActive ([`e74648f`](https://github.com/taskforcesh/bullmq/commit/e74648f22e3768474546f201050273f77bc5ea68))

* chore: move initMapping to constructor ([`4f35cee`](https://github.com/taskforcesh/bullmq/commit/4f35cee25e1767aa2134a0309558a09223d2c818))

* chore: add tests ([`dd8332a`](https://github.com/taskforcesh/bullmq/commit/dd8332a894915c2421f289fc7e851455c75cccdb))

* chore: remove bullmq-tests submodule ([`7ac95d2`](https://github.com/taskforcesh/bullmq/commit/7ac95d2d189157a8bc74889a9c6edc814ca69879))

### Feature

* feat(worker): make moveToActive protected ([`d2897ee`](https://github.com/taskforcesh/bullmq/commit/d2897ee7bbf4aee5251ac4fb28705f2bebbe7bfe))

### Fix

* fix(worker): use client for setting worker name ([`af65c2c`](https://github.com/taskforcesh/bullmq/commit/af65c2cd0d3fb232c617b018d4991f3276db11ea))

* fix: emit drain event if no jobs left when completing ([`9ad78a9`](https://github.com/taskforcesh/bullmq/commit/9ad78a91c0a4a74cf84bd77d351d98195104f0b6))

### Test

* test: fix deprecation warnings ([`ed16ac3`](https://github.com/taskforcesh/bullmq/commit/ed16ac3bfc5f78a1d5b4fdabccf6ec2c8db31d7e))


## v1.55.1 (2021-12-03)

### Chore

* chore(release): 1.55.1 [skip ci]

## [1.55.1](https://github.com/taskforcesh/bullmq/compare/v1.55.0...v1.55.1) (2021-12-03)

### Bug Fixes

* **worker:** always try to move to active after waiting for job ([#914](https://github.com/taskforcesh/bullmq/issues/914)) ([97b7084](https://github.com/taskforcesh/bullmq/commit/97b708451bf4ce14a461a50f8a24d14b0e40dd4b)) ([`5327a96`](https://github.com/taskforcesh/bullmq/commit/5327a9618932ffe5ffc632c13c73b8c26302074c))

* chore: add codeql-analysis ([`f6721dc`](https://github.com/taskforcesh/bullmq/commit/f6721dc34ccfc75d773cceaadc3c65e4c75eb6ad))

### Fix

* fix(worker): always try to move to active after waiting for job (#914) ([`97b7084`](https://github.com/taskforcesh/bullmq/commit/97b708451bf4ce14a461a50f8a24d14b0e40dd4b))

### Test

* test: fix test reference (#913) ([`c67aa6c`](https://github.com/taskforcesh/bullmq/commit/c67aa6c235ff7830c643e2fb291d1145b11b9de2))

### Unknown

* GitBook: [#81] docs: add pricing information for bullmq-pro ([`27a69f9`](https://github.com/taskforcesh/bullmq/commit/27a69f9b9540baadf692e62eb0c6857f0b86aa96))


## v1.55.0 (2021-12-02)

### Chore

* chore(release): 1.55.0 [skip ci]

# [1.55.0](https://github.com/taskforcesh/bullmq/compare/v1.54.6...v1.55.0) (2021-12-02)

### Features

* **script-loader:** lua script loader with include support ([#897](https://github.com/taskforcesh/bullmq/issues/897)) ([64b6ccf](https://github.com/taskforcesh/bullmq/commit/64b6ccf2a373b40d7ea763b3d35cf34f36ba11da)) ([`ae90c44`](https://github.com/taskforcesh/bullmq/commit/ae90c44e2ef79661440abbb9aae29345ca4e40ad))

### Documentation

* docs(bullmq-pro): add missing line in install instructions (#905) ([`53ba7b7`](https://github.com/taskforcesh/bullmq/commit/53ba7b798d75ead036b417c4644a7eab59b81cb4))

* docs(job): use defaultValue tag (#903) ([`3133599`](https://github.com/taskforcesh/bullmq/commit/3133599e982071fd1dfe7871f20b87eb6461cbf2))

### Feature

* feat(script-loader): lua script loader with include support (#897) ([`64b6ccf`](https://github.com/taskforcesh/bullmq/commit/64b6ccf2a373b40d7ea763b3d35cf34f36ba11da))

### Style

* style: fix styled github warnings (#904) ([`a008c2b`](https://github.com/taskforcesh/bullmq/commit/a008c2be6bc8fe73360ac97a6deabced04382ab4))


## v1.54.6 (2021-11-30)

### Chore

* chore(release): 1.54.6 [skip ci]

## [1.54.6](https://github.com/taskforcesh/bullmq/compare/v1.54.5...v1.54.6) (2021-11-30)

### Bug Fixes

* **stalled:** save finidhedOn when job stalled more than allowable limit ([#900](https://github.com/taskforcesh/bullmq/issues/900)) ([eb89edf](https://github.com/taskforcesh/bullmq/commit/eb89edf2f4eb85dedb1485de32e79331940a654f)) ([`0c0be5e`](https://github.com/taskforcesh/bullmq/commit/0c0be5e2c4b1192c45dcea16f3f0fdd725aa40fc))

* chore(deps): upgrade dev dependencies ([`9d108e3`](https://github.com/taskforcesh/bullmq/commit/9d108e30fbd47de3f4b32d2217bce8a1d0c9400c))

* chore(redis-connection): delete unused variables ([`437d9b3`](https://github.com/taskforcesh/bullmq/commit/437d9b35251fca132f56f1e075b84f5cdccebbde))

* chore: fix coverage action ([`72db663`](https://github.com/taskforcesh/bullmq/commit/72db663a52fd73ab62568ba06b2952dc57791f3b))

### Documentation

* docs: update logo ([`5ae0ec4`](https://github.com/taskforcesh/bullmq/commit/5ae0ec4ce63e6fe184b8edd4dfb462a5804cba02))

### Fix

* fix(stalled): save finidhedOn when job stalled more than allowable limit (#900) ([`eb89edf`](https://github.com/taskforcesh/bullmq/commit/eb89edf2f4eb85dedb1485de32e79331940a654f))

### Style

* style(eslint): warn ts ban types ([`1d8aaf2`](https://github.com/taskforcesh/bullmq/commit/1d8aaf2346c851846c4807cea1580f3360498f49))

### Unknown

* GitBook: [#80] docs: update install bullmq-pro ([`3805ce7`](https://github.com/taskforcesh/bullmq/commit/3805ce76d7db1b52dc8b3e32bae8221bb3ef9f96))


## v1.54.5 (2021-11-26)

### Chore

* chore(release): 1.54.5 [skip ci]

## [1.54.5](https://github.com/taskforcesh/bullmq/compare/v1.54.4...v1.54.5) (2021-11-26)

### Bug Fixes

* **tsconfig:** only include node types ([#895](https://github.com/taskforcesh/bullmq/issues/895)) ([5f4fdca](https://github.com/taskforcesh/bullmq/commit/5f4fdca5f416f2cd9d83eb0fba84e56c24320b63)) ([`f178fa9`](https://github.com/taskforcesh/bullmq/commit/f178fa984a7d53c8f92ea123ad476d92d153ab0f))

### Fix

* fix(tsconfig): only include node types (#895) ([`5f4fdca`](https://github.com/taskforcesh/bullmq/commit/5f4fdca5f416f2cd9d83eb0fba84e56c24320b63))

### Test

* test: fix test checkout ([`e9859fc`](https://github.com/taskforcesh/bullmq/commit/e9859fcf826ded5e2efedeba753a99d4f9ff9145))

* test: correct test paths ([`4bc5e75`](https://github.com/taskforcesh/bullmq/commit/4bc5e7512c0982989289aacb685b35fbb3bc5a82))

* test: add tests as an external module ([`19d3de4`](https://github.com/taskforcesh/bullmq/commit/19d3de4f9a6ed65b211e8cb903f20e5a47e0bbe2))


## v1.54.4 (2021-11-24)

### Chore

* chore(release): 1.54.4 [skip ci]

## [1.54.4](https://github.com/taskforcesh/bullmq/compare/v1.54.3...v1.54.4) (2021-11-24)

### Bug Fixes

* **child-processor:** add deprecation warning for progress method ([#890](https://github.com/taskforcesh/bullmq/issues/890)) ([f80b19a](https://github.com/taskforcesh/bullmq/commit/f80b19a5aa85413b8906aa0fac1bfd09bec990cb)) ([`9469c36`](https://github.com/taskforcesh/bullmq/commit/9469c36cdbeb67491534f580f05f704d7c325d4b))

* chore: move pre-commit to husky hooks ([`a83c822`](https://github.com/taskforcesh/bullmq/commit/a83c822b6706432b604329e2da47d5f3ec1837a9))

### Documentation

* docs: add missing returned types (#889) ([`3c76dc4`](https://github.com/taskforcesh/bullmq/commit/3c76dc4fa3558fa83161537751bc68eeb65e9d4a))

### Fix

* fix(child-processor): add deprecation warning for progress method (#890) ([`f80b19a`](https://github.com/taskforcesh/bullmq/commit/f80b19a5aa85413b8906aa0fac1bfd09bec990cb))

### Refactor

* refactor(sandbox): use utilty functions instead of send ([`7619e23`](https://github.com/taskforcesh/bullmq/commit/7619e232faf759c0456e83bef7b35064278f2453))

* refactor: refactor sandoxes related code ([`bd0131d`](https://github.com/taskforcesh/bullmq/commit/bd0131dabfe3c6983d6b2c68cdd974c60d947314))

* refactor: provide a protected method for calling process job ([`b6c9166`](https://github.com/taskforcesh/bullmq/commit/b6c9166e7cc74e5deb17cbf8ec3ad495bd0b7720))


## v1.54.3 (2021-11-22)

### Chore

* chore(release): 1.54.3 [skip ci]

## [1.54.3](https://github.com/taskforcesh/bullmq/compare/v1.54.2...v1.54.3) (2021-11-22)

### Bug Fixes

* **clean:** use range values in lua script ([#885](https://github.com/taskforcesh/bullmq/issues/885)) ([02ef63a](https://github.com/taskforcesh/bullmq/commit/02ef63a8163e627a270a1c1bd74989a67c3f15f7)) ([`22eabe5`](https://github.com/taskforcesh/bullmq/commit/22eabe5e7d515a501f427b4dca05b2b398f60412))

### Fix

* fix(clean): use range values in lua script (#885) ([`02ef63a`](https://github.com/taskforcesh/bullmq/commit/02ef63a8163e627a270a1c1bd74989a67c3f15f7))


## v1.54.2 (2021-11-20)

### Chore

* chore(release): 1.54.2 [skip ci]

## [1.54.2](https://github.com/taskforcesh/bullmq/compare/v1.54.1...v1.54.2) (2021-11-20)

### Bug Fixes

* **job:** use this when use new operators ([#884](https://github.com/taskforcesh/bullmq/issues/884)) ([7b84283](https://github.com/taskforcesh/bullmq/commit/7b842839e1d30967ebf15b901033e3b31e929df8)) ([`03f6eb3`](https://github.com/taskforcesh/bullmq/commit/03f6eb3d536dc4dd00c0d75338eb72678f397a69))

### Fix

* fix(job): use this when use new operators (#884) ([`7b84283`](https://github.com/taskforcesh/bullmq/commit/7b842839e1d30967ebf15b901033e3b31e929df8))


## v1.54.1 (2021-11-19)

### Chore

* chore(release): 1.54.1 [skip ci]

## [1.54.1](https://github.com/taskforcesh/bullmq/compare/v1.54.0...v1.54.1) (2021-11-19)

### Bug Fixes

* **job:** change private attributes to protected for extensions ([#882](https://github.com/taskforcesh/bullmq/issues/882)) ([ffcc3f0](https://github.com/taskforcesh/bullmq/commit/ffcc3f083c23e6de3587c38fb7aacb2e19085351)) ([`5024c18`](https://github.com/taskforcesh/bullmq/commit/5024c186b4bafaa6c416799c782331934fa19eb1))

### Fix

* fix(job): change private attributes to protected for extensions (#882) ([`ffcc3f0`](https://github.com/taskforcesh/bullmq/commit/ffcc3f083c23e6de3587c38fb7aacb2e19085351))


## v1.54.0 (2021-11-17)

### Chore

* chore(release): 1.54.0 [skip ci]

# [1.54.0](https://github.com/taskforcesh/bullmq/compare/v1.53.0...v1.54.0) (2021-11-17)

### Features

* **load-includes:** export includes to be reused in extensions ([#877](https://github.com/taskforcesh/bullmq/issues/877)) ([b56c4a9](https://github.com/taskforcesh/bullmq/commit/b56c4a9cf2ecebb44481618026589162be61680a)) ([`d6519f1`](https://github.com/taskforcesh/bullmq/commit/d6519f1a185decdd544667115657e00239c9d6ee))

### Feature

* feat(load-includes): export includes to be reused in extensions (#877) ([`b56c4a9`](https://github.com/taskforcesh/bullmq/commit/b56c4a9cf2ecebb44481618026589162be61680a))


## v1.53.0 (2021-11-16)

### Chore

* chore(release): 1.53.0 [skip ci]

# [1.53.0](https://github.com/taskforcesh/bullmq/compare/v1.52.2...v1.53.0) (2021-11-16)

### Features

* **queue-events:** add cleaned event ([#865](https://github.com/taskforcesh/bullmq/issues/865)) ([b3aebad](https://github.com/taskforcesh/bullmq/commit/b3aebad8a62311e135d53be2e7c5e47740547465)) ([`14e4f31`](https://github.com/taskforcesh/bullmq/commit/14e4f318e3c4ca2eb3fd065d79f1813c6ed7f8eb))

### Feature

* feat(queue-events): add cleaned event (#865) ([`b3aebad`](https://github.com/taskforcesh/bullmq/commit/b3aebad8a62311e135d53be2e7c5e47740547465))


## v1.52.2 (2021-11-14)

### Chore

* chore(release): 1.52.2 [skip ci]

## [1.52.2](https://github.com/taskforcesh/bullmq/compare/v1.52.1...v1.52.2) (2021-11-14)

### Bug Fixes

* **worker:** change private attributes to protected for pro extension ([#874](https://github.com/taskforcesh/bullmq/issues/874)) ([1c73881](https://github.com/taskforcesh/bullmq/commit/1c738819b49f206688ed7b3b9d103077045e1b05)) ([`e73580b`](https://github.com/taskforcesh/bullmq/commit/e73580ba747b304924643ba9c710449e9b254716))

### Fix

* fix(worker): change private attributes to protected for pro extension (#874) ([`1c73881`](https://github.com/taskforcesh/bullmq/commit/1c738819b49f206688ed7b3b9d103077045e1b05))


## v1.52.1 (2021-11-12)

### Chore

* chore(release): 1.52.1 [skip ci]

## [1.52.1](https://github.com/taskforcesh/bullmq/compare/v1.52.0...v1.52.1) (2021-11-12)

### Performance Improvements

* **clean:** speed up clean method when called with limit param ([#864](https://github.com/taskforcesh/bullmq/issues/864)) ([09b5cb4](https://github.com/taskforcesh/bullmq/commit/09b5cb45a79c4bc53a52d540918c22477a066e16)) ([`d59475c`](https://github.com/taskforcesh/bullmq/commit/d59475ce4d3ad1181dde613e47e7318812f23110))

* chore(deps): apply rimraf to delete extra published files (#873) ([`e84620c`](https://github.com/taskforcesh/bullmq/commit/e84620c785f388ed14742c86d78dd78fb05218de))

### Performance

* perf(clean): speed up clean method when called with limit param (#864) ([`09b5cb4`](https://github.com/taskforcesh/bullmq/commit/09b5cb45a79c4bc53a52d540918c22477a066e16))


## v1.52.0 (2021-11-11)

### Chore

* chore(release): 1.52.0 [skip ci]

# [1.52.0](https://github.com/taskforcesh/bullmq/compare/v1.51.3...v1.52.0) (2021-11-11)

### Features

* **queue:** add waiting event type declaration ([#872](https://github.com/taskforcesh/bullmq/issues/872)) ([f29925d](https://github.com/taskforcesh/bullmq/commit/f29925da3b12f573582ea188ec386e86023cefc9)) ([`2048a9b`](https://github.com/taskforcesh/bullmq/commit/2048a9b47f69166805858fdc3a18c940deb42049))

* chore(deps): upgrade @semantic-release/github (#867) to 8.0.2 ([`9621383`](https://github.com/taskforcesh/bullmq/commit/96213838121f4a52d71ce07928f2c5f9cb46fa9c))

### Ci

* ci(node-workflow): allow run tests in next branch (#852) ([`6009054`](https://github.com/taskforcesh/bullmq/commit/6009054c53ef447d02173f6a7a88fe6a7eb03581))

### Feature

* feat(queue): add waiting event type declaration (#872) ([`f29925d`](https://github.com/taskforcesh/bullmq/commit/f29925da3b12f573582ea188ec386e86023cefc9))

### Test

* test(worker): check finishedOn value passed in completed event (#866) ref #863 ([`ef47aa9`](https://github.com/taskforcesh/bullmq/commit/ef47aa93b0808f3027c85e17aee3be12e716ff8c))


## v1.51.3 (2021-11-04)

### Chore

* chore(release): 1.51.3 [skip ci]

## [1.51.3](https://github.com/taskforcesh/bullmq/compare/v1.51.2...v1.51.3) (2021-11-04)

### Bug Fixes

* **move-to-failed:** delete closing check that prevents script execution ([#858](https://github.com/taskforcesh/bullmq/issues/858)) fixes [#834](https://github.com/taskforcesh/bullmq/issues/834) ([d50814f](https://github.com/taskforcesh/bullmq/commit/d50814f864448c10fec8e93651a2095fa4ef3f4e)) ([`be186d9`](https://github.com/taskforcesh/bullmq/commit/be186d9e6f3c3bf1d4afb0e1423935190681de34))

### Fix

* fix(move-to-failed): delete closing check that prevents script execution (#858) fixes #834 ([`d50814f`](https://github.com/taskforcesh/bullmq/commit/d50814f864448c10fec8e93651a2095fa4ef3f4e))


## v1.51.2 (2021-11-03)

### Chore

* chore(release): 1.51.2 [skip ci]

## [1.51.2](https://github.com/taskforcesh/bullmq/compare/v1.51.1...v1.51.2) (2021-11-03)

### Bug Fixes

* **flow:** remove repeat option from FlowJob opts ([#853](https://github.com/taskforcesh/bullmq/issues/853)) fixes [#851](https://github.com/taskforcesh/bullmq/issues/851) ([c9ee2f1](https://github.com/taskforcesh/bullmq/commit/c9ee2f100a23aa24034598b7d452c69720d7aabd)) ([`8c8a5df`](https://github.com/taskforcesh/bullmq/commit/8c8a5df4121560a7325bbbadb8ec77b59fad3505))

* chore(deps): add npm-run-all into dev-dependencies (#847) ([`315d5dd`](https://github.com/taskforcesh/bullmq/commit/315d5dda39bcfb3223976d1a6da8e11d0a4902a5))

### Documentation

* docs: use implements for declaration types (#845) ([`2446cea`](https://github.com/taskforcesh/bullmq/commit/2446cea3d99d9b1bd738e7a8480c395984f8f17c))

### Fix

* fix(flow): remove repeat option from FlowJob opts (#853) fixes #851 ([`c9ee2f1`](https://github.com/taskforcesh/bullmq/commit/c9ee2f100a23aa24034598b7d452c69720d7aabd))

### Unknown

* GitBook: [#79] correct groups paragraph ([`0460246`](https://github.com/taskforcesh/bullmq/commit/0460246ea4d9c79264b601671ce4794603fa1bdc))

* GitBook: [#78] docs: update custom job ids ([`b157171`](https://github.com/taskforcesh/bullmq/commit/b1571712311856f72c2eea4315bb2e5ca06015f7))

* GitBook: [#77] docs: add job ids page ([`cea2742`](https://github.com/taskforcesh/bullmq/commit/cea274258858517f648e2d6cacdb73ca0659cf25))


## v1.51.1 (2021-10-29)

### Chore

* chore(release): 1.51.1 [skip ci]

## [1.51.1](https://github.com/taskforcesh/bullmq/compare/v1.51.0...v1.51.1) (2021-10-29)

### Bug Fixes

* **commands:** copy includes lua scripts ([#843](https://github.com/taskforcesh/bullmq/issues/843)) fixes [#837](https://github.com/taskforcesh/bullmq/issues/837) ([cab33e0](https://github.com/taskforcesh/bullmq/commit/cab33e08bc78bd3c45b86158a818100beeb06d81)) ([`1c99cc7`](https://github.com/taskforcesh/bullmq/commit/1c99cc7f00097ee77669378c6e1c291677b330df))

### Fix

* fix(commands): copy includes lua scripts (#843) fixes #837 ([`cab33e0`](https://github.com/taskforcesh/bullmq/commit/cab33e08bc78bd3c45b86158a818100beeb06d81))


## v1.51.0 (2021-10-28)

### Chore

* chore(release): 1.51.0 [skip ci]

# [1.51.0](https://github.com/taskforcesh/bullmq/compare/v1.50.7...v1.51.0) (2021-10-28)

### Features

* **flow:** consider continually adding jobs ([#828](https://github.com/taskforcesh/bullmq/issues/828)) fixes [#826](https://github.com/taskforcesh/bullmq/issues/826) ([b0fde69](https://github.com/taskforcesh/bullmq/commit/b0fde69f4370160a891e4654485c09745066b80b)) ([`8231052`](https://github.com/taskforcesh/bullmq/commit/82310524849b8aaae0ab8e427f4a0637fadaa2de))

### Feature

* feat(flow): consider continually adding jobs (#828) fixes #826 ([`b0fde69`](https://github.com/taskforcesh/bullmq/commit/b0fde69f4370160a891e4654485c09745066b80b))


## v1.50.7 (2021-10-28)

### Chore

* chore(release): 1.50.7 [skip ci]

## [1.50.7](https://github.com/taskforcesh/bullmq/compare/v1.50.6...v1.50.7) (2021-10-28)

### Bug Fixes

* override enableReadyCheck, maxRetriesPerRequest fixes reconnection ([09ba358](https://github.com/taskforcesh/bullmq/commit/09ba358b6f761bdc52b0f5b2aa315cc6c2a9db6e))
* **queue-base:** deprecation warning on missing connection ([2f79802](https://github.com/taskforcesh/bullmq/commit/2f79802378d7e015b5d0702945a71c1c2073251e)) ([`da1add8`](https://github.com/taskforcesh/bullmq/commit/da1add8d2970216b953406d1c1109b36bfa05c5c))

* chore: remove some lodash functions (#835) ([`fcc48e3`](https://github.com/taskforcesh/bullmq/commit/fcc48e3fb4263950f355e9fd9a233a20fe18f380))

### Fix

* fix: override enableReadyCheck, maxRetriesPerRequest fixes reconnection ([`09ba358`](https://github.com/taskforcesh/bullmq/commit/09ba358b6f761bdc52b0f5b2aa315cc6c2a9db6e))

* fix(queue-base): deprecation warning on missing connection ([`2f79802`](https://github.com/taskforcesh/bullmq/commit/2f79802378d7e015b5d0702945a71c1c2073251e))


## v1.50.6 (2021-10-28)

### Chore

* chore(release): 1.50.6 [skip ci]

## [1.50.6](https://github.com/taskforcesh/bullmq/compare/v1.50.5...v1.50.6) (2021-10-28)

### Bug Fixes

* **queue-base:** show connection deprecation warning ([#832](https://github.com/taskforcesh/bullmq/issues/832)) fixes [#829](https://github.com/taskforcesh/bullmq/issues/829) ([5d023fe](https://github.com/taskforcesh/bullmq/commit/5d023fe7b671a2547398fd68995ccd85216cc7a5)) ([`2c191b0`](https://github.com/taskforcesh/bullmq/commit/2c191b0e079bf412f292617c88917eec3c9b00de))

### Ci

* ci(github): set test job and cache (#820) ([`d810465`](https://github.com/taskforcesh/bullmq/commit/d810465a4549da871e53d8bed496118afda61fb0))

### Fix

* fix(queue-base): show connection deprecation warning (#832) fixes #829 ([`5d023fe`](https://github.com/taskforcesh/bullmq/commit/5d023fe7b671a2547398fd68995ccd85216cc7a5))

### Test

* test(flow): add backoff strategy case (#827) ([`a0cae58`](https://github.com/taskforcesh/bullmq/commit/a0cae58ca0c3c489309c6ad626fb5d6147bdf92d))


## v1.50.5 (2021-10-21)

### Chore

* chore(release): 1.50.5 [skip ci]

## [1.50.5](https://github.com/taskforcesh/bullmq/compare/v1.50.4...v1.50.5) (2021-10-21)

### Bug Fixes

* **child-pool:** pipe process stdout and stderr([#822](https://github.com/taskforcesh/bullmq/issues/822)) fixes [#821](https://github.com/taskforcesh/bullmq/issues/821) ([13f5c62](https://github.com/taskforcesh/bullmq/commit/13f5c62174925e4638acda6a9de379668048189d)) ([`7dcbe43`](https://github.com/taskforcesh/bullmq/commit/7dcbe43ccc3c69625e6fba72f80d71dd755690b3))

### Fix

* fix(child-pool): pipe process stdout and stderr(#822) fixes #821 ([`13f5c62`](https://github.com/taskforcesh/bullmq/commit/13f5c62174925e4638acda6a9de379668048189d))

### Test

* test: add test case for shared connections ([`3c8906e`](https://github.com/taskforcesh/bullmq/commit/3c8906e910c8aa399b9b591f87c19427d685b69d))


## v1.50.4 (2021-10-20)

### Chore

* chore(release): 1.50.4 [skip ci]

## [1.50.4](https://github.com/taskforcesh/bullmq/compare/v1.50.3...v1.50.4) (2021-10-20)

### Bug Fixes

* properly pass sharedConnection option to worker base class ([56557f1](https://github.com/taskforcesh/bullmq/commit/56557f1c0c3fb04bc3dd8824819c2d4367324c3b)) ([`fdc76ff`](https://github.com/taskforcesh/bullmq/commit/fdc76ff9b8781a1735933514a8b2b5eac510b789))

### Fix

* fix: properly pass sharedConnection option to worker base class ([`56557f1`](https://github.com/taskforcesh/bullmq/commit/56557f1c0c3fb04bc3dd8824819c2d4367324c3b))

### Unknown

* GitBook: [#74] update bullmq-pro docs ([`b61b9a8`](https://github.com/taskforcesh/bullmq/commit/b61b9a8ccca16554d4a0c03eb14ed3e6fe5a7543))

* GitBook: [#73] update bullmq-pro docs ([`fce0070`](https://github.com/taskforcesh/bullmq/commit/fce00701930e188844218453f2aeb68087cf111d))

* GitBook: [#72] update groups ([`c99069a`](https://github.com/taskforcesh/bullmq/commit/c99069a481102e57889872aac1ad7d9f4fee58e4))

* GitBook: [#71] update groups ([`8dc7f36`](https://github.com/taskforcesh/bullmq/commit/8dc7f36fa9e91f1d9f876db82dccbdbd2b8e3bbd))

* GitBook: [#70] add groups diagram ([`00be74a`](https://github.com/taskforcesh/bullmq/commit/00be74afc99f255999a0a7aaf1c971d68f67e382))

* GitBook: [#69] update bullmq-pro install instructions ([`b47d5ef`](https://github.com/taskforcesh/bullmq/commit/b47d5ef32ebcdf7363c059481491b8c22aec041b))


## v1.50.3 (2021-10-18)

### Chore

* chore(release): 1.50.3 [skip ci]

## [1.50.3](https://github.com/taskforcesh/bullmq/compare/v1.50.2...v1.50.3) (2021-10-18)

### Bug Fixes

* **msgpackr:** upgrade version to 1.4.6 to support esm bundlers ([#818](https://github.com/taskforcesh/bullmq/issues/818)) fixes [#813](https://github.com/taskforcesh/bullmq/issues/813) ([913d7a9](https://github.com/taskforcesh/bullmq/commit/913d7a9a892d2c7e2fa5822367355c2dee888583)) ([`19da60a`](https://github.com/taskforcesh/bullmq/commit/19da60a6006d0df9e0cb81ea810d3c2673e46350))

### Documentation

* docs(remove): fix id typo (#805) ([`51eebc4`](https://github.com/taskforcesh/bullmq/commit/51eebc4ca25f3cada743f5e0a3e7e8878b82bc7e))

### Fix

* fix(msgpackr): upgrade version to 1.4.6 to support esm bundlers (#818) fixes #813 ([`913d7a9`](https://github.com/taskforcesh/bullmq/commit/913d7a9a892d2c7e2fa5822367355c2dee888583))

### Unknown

* GitBook: [#68] docs: more updates to bull documentation ([`478e90a`](https://github.com/taskforcesh/bullmq/commit/478e90ac39005198be07d731c50c9df4cae2f674))

* GitBook: [#67] add initial bullmq-pro and groups documentation ([`123e784`](https://github.com/taskforcesh/bullmq/commit/123e7846b65b43c1f19540aaa2de41b3dd94fb0e))


## v1.50.2 (2021-10-12)

### Chore

* chore(release): 1.50.2 [skip ci]

## [1.50.2](https://github.com/taskforcesh/bullmq/compare/v1.50.1...v1.50.2) (2021-10-12)

### Bug Fixes

* **msgpack:** replace msgpack by msgpackr ([dc13a75](https://github.com/taskforcesh/bullmq/commit/dc13a75374bbd29fefbf3e56f822e763df3712d9)) ([`23c02b2`](https://github.com/taskforcesh/bullmq/commit/23c02b2eee3c4e27e0370317779b1620b195e2f5))

### Fix

* fix(msgpack): replace msgpack by msgpackr ([`dc13a75`](https://github.com/taskforcesh/bullmq/commit/dc13a75374bbd29fefbf3e56f822e763df3712d9))

### Test

* test(events): fix broken text ([`67ab17d`](https://github.com/taskforcesh/bullmq/commit/67ab17d0093edcba4f784531c0e601b32cff5e1f))


## v1.50.1 (2021-10-12)

### Chore

* chore(release): 1.50.1 [skip ci]

## [1.50.1](https://github.com/taskforcesh/bullmq/compare/v1.50.0...v1.50.1) (2021-10-12)

### Bug Fixes

* **queue-getters:** only getting the first 2 jobs ([653873a](https://github.com/taskforcesh/bullmq/commit/653873a6a86dd6c3e1afc3142efbe11014d80557)) ([`4768d7b`](https://github.com/taskforcesh/bullmq/commit/4768d7b1f843dcac14bef62edbfab3d1242dec64))

* chore(test_getters): check order for completed jobs ([`7b3e718`](https://github.com/taskforcesh/bullmq/commit/7b3e7189dc30947427ce94a1bd39cc481077a117))

* chore(test_getters): add tests for waiting and failed getters ([`426a2a7`](https://github.com/taskforcesh/bullmq/commit/426a2a753d5b5e6a561937c4ad34ab5cc028c65c))

### Fix

* fix(queue-getters): only getting the first 2 jobs ([`653873a`](https://github.com/taskforcesh/bullmq/commit/653873a6a86dd6c3e1afc3142efbe11014d80557))


## v1.50.0 (2021-10-12)

### Chore

* chore(release): 1.50.0 [skip ci]

# [1.50.0](https://github.com/taskforcesh/bullmq/compare/v1.49.0...v1.50.0) (2021-10-12)

### Features

* easier to build extensions on top of BullMQ ([b1a9e64](https://github.com/taskforcesh/bullmq/commit/b1a9e64a9184addc0b8245a04013e1c896e9c2bc)) ([`2d646d1`](https://github.com/taskforcesh/bullmq/commit/2d646d169f9ad084b6fc8c47316aaa77821126ea))

### Documentation

* docs(child-pool): add link to process exit codes (#799) ([`1f12295`](https://github.com/taskforcesh/bullmq/commit/1f122952a0f161c754b5ddbba75db2880a4554c8))

### Feature

* feat: easier to build extensions on top of BullMQ ([`b1a9e64`](https://github.com/taskforcesh/bullmq/commit/b1a9e64a9184addc0b8245a04013e1c896e9c2bc))


## v1.49.0 (2021-10-08)

### Chore

* chore(release): 1.49.0 [skip ci]

# [1.49.0](https://github.com/taskforcesh/bullmq/compare/v1.48.3...v1.49.0) (2021-10-08)

### Features

* **sandboxed-process:** handle init-failed error ([#797](https://github.com/taskforcesh/bullmq/issues/797)) ([5d2f553](https://github.com/taskforcesh/bullmq/commit/5d2f55342b19ee99d34f8d8003f09359cfe17d4f)) ([`daaa73e`](https://github.com/taskforcesh/bullmq/commit/daaa73e2016948e715f11e67fac1bf261dadb33a))

### Documentation

* docs(change-delay): add param in docs (#792) ([`58a803f`](https://github.com/taskforcesh/bullmq/commit/58a803ff2e6a1815b4000dc16584663e33dace09))

* docs(readme): add semantic-release badge (#795) ([`2f1b141`](https://github.com/taskforcesh/bullmq/commit/2f1b14197786282292ce5150c008a61a7f44f19e))

### Feature

* feat(sandboxed-process): handle init-failed error (#797) ([`5d2f553`](https://github.com/taskforcesh/bullmq/commit/5d2f55342b19ee99d34f8d8003f09359cfe17d4f))

### Test

* test(sandboxed-process): add test case where process.env is shared (#793) ([`479c425`](https://github.com/taskforcesh/bullmq/commit/479c425aeac01e218de661f6ba357d0ed2f116aa))


## v1.48.3 (2021-10-05)

### Chore

* chore(release): 1.48.3 [skip ci]

## [1.48.3](https://github.com/taskforcesh/bullmq/compare/v1.48.2...v1.48.3) (2021-10-05)

### Bug Fixes

* **change-delay:** add current time to delay ([#789](https://github.com/taskforcesh/bullmq/issues/789)) fixes [#787](https://github.com/taskforcesh/bullmq/issues/787) ([4a70def](https://github.com/taskforcesh/bullmq/commit/4a70def6e85cf9ea384ec5f38c3c4f83e4eb523c)) ([`4e09a2a`](https://github.com/taskforcesh/bullmq/commit/4e09a2a97bb9eab6c5c3db1294aa1aa4fd3730b0))

* chore(@microsoft/api-extractor): upgrade to 7.18.9 ([`366a113`](https://github.com/taskforcesh/bullmq/commit/366a113507e22d696b9822868889881195c05fb1))

* chore(@microsoft/api-documenter): upgrade to 7.13.50 ([`5581642`](https://github.com/taskforcesh/bullmq/commit/5581642ddcc33bfd0581c13e6f7cff0142076ff7))

* chore(coveralls): upgrade to 3.1.1 ([`812da7e`](https://github.com/taskforcesh/bullmq/commit/812da7e832644e3abf60726be00df43302bd2d87))

* chore(copyfiles): upgrade to 2.4.1 ([`d8510a1`](https://github.com/taskforcesh/bullmq/commit/d8510a19159062d10c482938eaf3f5187c123887))

* chore(semantic-release): upgrade to 17.4.7 (#778) ([`477bdae`](https://github.com/taskforcesh/bullmq/commit/477bdae9d037a92f9d94457c9476b2b3aba6c671))

* chore(@semantic-release/git): upgrade to 9.0.1 ([`f57fea0`](https://github.com/taskforcesh/bullmq/commit/f57fea0750a3421a14bd056ba511eac5b6475ad1))

* chore(sinon): upgrade to 7.5.0 ([`cb60a5f`](https://github.com/taskforcesh/bullmq/commit/cb60a5f1b62116f056c9a16836a5f05d68bb39ee))

* chore(pretty-quick): upgrade to 3.1.1 ([`b711907`](https://github.com/taskforcesh/bullmq/commit/b711907d682e2de4219f35bc3c05c90d545d18b3))

* chore(prettier): upgrade to 2.4.1 ([`3d603b7`](https://github.com/taskforcesh/bullmq/commit/3d603b778697cb71b2dbe690574598acb524de5b))

* chore(@semantic-release/release-notes-generator): upgrade to 9.0.3 ([`3c01ad4`](https://github.com/taskforcesh/bullmq/commit/3c01ad4fd66231987d6a6be3a73c4c61052bf84a))

* chore(@types/chai): upgrade to 4.2.22 ([`982aa08`](https://github.com/taskforcesh/bullmq/commit/982aa0854aaedde685309fb15e9d495e9fbaa000))

* chore(@types/chai-as-promised): upgrade to 7.1.4 ([`4e8fef3`](https://github.com/taskforcesh/bullmq/commit/4e8fef35e1bddcf55e51b27705d60c9e9ad55d0c))

* chore(@commitlint/config-conventional): upgrade to 8.3.4 ([`c754bc4`](https://github.com/taskforcesh/bullmq/commit/c754bc4d591bcc7377c5c1e0f2aa467f6261e8bc))

* chore(@commitlint/cli): upgrade to 8.3.5 ([`969cc58`](https://github.com/taskforcesh/bullmq/commit/969cc581aea069ba881a4a2cd3f97472a5c95990))

* chore(@types/lodash): upgrade to 4.14.173 ([`753417a`](https://github.com/taskforcesh/bullmq/commit/753417aee792f59da8cf7c92c9fa3309770144ea))

* chore(eslint-plugin-mocha): upgrade to 8.2.0 ([`0e7dc9a`](https://github.com/taskforcesh/bullmq/commit/0e7dc9a3eaaf248abfee425672b939d83ba79774))

* chore(husky): upgrade to 3.1.0 ([`c89de04`](https://github.com/taskforcesh/bullmq/commit/c89de0453c78b470d3c1495391185386cec4ae51))

* chore(mocha): upgrade to 6.2.3 ([`c489734`](https://github.com/taskforcesh/bullmq/commit/c4897344f7ef802587ce1847833af37566ffe4ea))

* chore(ts-mocha): upgrade to 8.0.0 ([`a4d8f7f`](https://github.com/taskforcesh/bullmq/commit/a4d8f7f5e06e7a0d0d1cf1e5d27864a661df139c))

* chore(ts-node): upgrade to 8.10.2 ([`32909ba`](https://github.com/taskforcesh/bullmq/commit/32909babd11eda160158aed900282bbb4c504ea8))

* chore(typescript): upgrade to 3.9.10 ([`9a5e860`](https://github.com/taskforcesh/bullmq/commit/9a5e8602a37a4ab05199a1d32635853a9a717390))

* chore(@types/mocha): upgrade to 5.2.7 ([`c6de08e`](https://github.com/taskforcesh/bullmq/commit/c6de08efd148c91d313c50ebc1b98f100c965008))

* chore(@types/node): upgrade to 12.20.25 ([`04a6cee`](https://github.com/taskforcesh/bullmq/commit/04a6cee6ec81a083259919a5db091b2360da3a10))

* chore(@types/semver): upgrade to 6.2.3 ([`6d46d9c`](https://github.com/taskforcesh/bullmq/commit/6d46d9cfdf054a5b358ac42c8cd3e587cd13f6d0))

* chore(@types/sinon): upgrade to 7.5.2 ([`2bfe5df`](https://github.com/taskforcesh/bullmq/commit/2bfe5df7b4c841c3daec8beab405a05a6a8d0391))

* chore(@types/uuid): upgrade to 3.4.10 ([`71727bd`](https://github.com/taskforcesh/bullmq/commit/71727bd6610e991ec715adc769568dd15fde8ae1))

* chore(tslib): upgrade to 1.14.1 ([`b4d87b5`](https://github.com/taskforcesh/bullmq/commit/b4d87b5bf94d67bef1edfcdd0bfdf677fc4e0c39))

* chore(ioredis): upgrade to 4.27.9 ([`1d95209`](https://github.com/taskforcesh/bullmq/commit/1d95209671ac0b7d4fd1cc60927580f900a68556))

* chore(get-port): upgrade to 5.1.1 ([`3bb79d0`](https://github.com/taskforcesh/bullmq/commit/3bb79d038fb9f3fabec62ef3fa72bdf3a704ae39))

* chore(cron-parser): upgrade to 2.18.0 ([`1ab8716`](https://github.com/taskforcesh/bullmq/commit/1ab8716f8833c2a1b730d530f06e96330b1e0ec1))

### Documentation

* docs(events): update completed and failed events docs (#785) ([`3712537`](https://github.com/taskforcesh/bullmq/commit/371253744ec89f8edcc868ee9236681deab62dbf))

* docs: correct bird&#39;s name &amp; comparative adjective for repeatable frequency ([`cb4292c`](https://github.com/taskforcesh/bullmq/commit/cb4292ca13af145140eedb5960ccbff87644953f))

* docs(autorun): add documentation (#769) ref #263 ([`b016344`](https://github.com/taskforcesh/bullmq/commit/b016344caedc8915052cea43948901f3b77b6ece))

### Fix

* fix(change-delay): add current time to delay (#789) fixes #787 ([`4a70def`](https://github.com/taskforcesh/bullmq/commit/4a70def6e85cf9ea384ec5f38c3c4f83e4eb523c))

### Refactor

* refactor(reprocess-job): change error messages (#768) ([`5cbd3b6`](https://github.com/taskforcesh/bullmq/commit/5cbd3b6aea64fb1eeee6a8d5c51797eb02b63d73))

### Style

* style: remove unused variables (#771) ([`044250b`](https://github.com/taskforcesh/bullmq/commit/044250b370565cfbcd6f9628e3c4e289dd5937e9))


## v1.48.2 (2021-09-24)

### Chore

* chore(release): 1.48.2 [skip ci]

## [1.48.2](https://github.com/taskforcesh/bullmq/compare/v1.48.1...v1.48.2) (2021-09-24)

### Performance Improvements

* **obliterate:** do not pass unused variables ([#766](https://github.com/taskforcesh/bullmq/issues/766)) ([e9abfa6](https://github.com/taskforcesh/bullmq/commit/e9abfa6f821064901770a9b72adfb00cac96154c)) ([`1b5317a`](https://github.com/taskforcesh/bullmq/commit/1b5317a5f5488fefe367550c518e5c2584ced300))

### Performance

* perf(obliterate): do not pass unused variables (#766) ([`e9abfa6`](https://github.com/taskforcesh/bullmq/commit/e9abfa6f821064901770a9b72adfb00cac96154c))


## v1.48.1 (2021-09-23)

### Chore

* chore(release): 1.48.1 [skip ci]

## [1.48.1](https://github.com/taskforcesh/bullmq/compare/v1.48.0...v1.48.1) (2021-09-23)

### Bug Fixes

* **obliterate:** consider dependencies and processed keys ([#765](https://github.com/taskforcesh/bullmq/issues/765)) ([fd6bad8](https://github.com/taskforcesh/bullmq/commit/fd6bad8c7444c21e6f1d67611a28f8e4aace293d)) ([`1fbb80d`](https://github.com/taskforcesh/bullmq/commit/1fbb80ded6dd22b755757b4699667351eda0b106))

### Fix

* fix(obliterate): consider dependencies and processed keys (#765) ([`fd6bad8`](https://github.com/taskforcesh/bullmq/commit/fd6bad8c7444c21e6f1d67611a28f8e4aace293d))


## v1.48.0 (2021-09-23)

### Chore

* chore(release): 1.48.0 [skip ci]

# [1.48.0](https://github.com/taskforcesh/bullmq/compare/v1.47.2...v1.48.0) (2021-09-23)

### Features

* **queue:** add drain lua script ([#764](https://github.com/taskforcesh/bullmq/issues/764)) ([2daa698](https://github.com/taskforcesh/bullmq/commit/2daa698a7cc5dc8a6cd087b2d29356bc02fb4944)) ([`4c91ad5`](https://github.com/taskforcesh/bullmq/commit/4c91ad549830ccf10d0dc599aabbeaf3466fdb26))

### Feature

* feat(queue): add drain lua script (#764) ([`2daa698`](https://github.com/taskforcesh/bullmq/commit/2daa698a7cc5dc8a6cd087b2d29356bc02fb4944))


## v1.47.2 (2021-09-22)

### Chore

* chore(release): 1.47.2 [skip ci]

## [1.47.2](https://github.com/taskforcesh/bullmq/compare/v1.47.1...v1.47.2) (2021-09-22)

### Bug Fixes

* **flow-producer:** use default prefix in add method ([#763](https://github.com/taskforcesh/bullmq/issues/763)) fixes [#762](https://github.com/taskforcesh/bullmq/issues/762) ([fffdb55](https://github.com/taskforcesh/bullmq/commit/fffdb55f37917776494a4471673ef4564e0faab5)) ([`375f7c1`](https://github.com/taskforcesh/bullmq/commit/375f7c18432b36802bc521bfa78855278a834963))

* chore(deps): bump semver-regex from 3.1.2 to 3.1.3 (#761) ([`4586cda`](https://github.com/taskforcesh/bullmq/commit/4586cdab0ca52f28e12449ff6f82f7c6124a2c12))

### Documentation

* docs(feature-comparison): fix parent-child checks (#759) ([`b2c6bcc`](https://github.com/taskforcesh/bullmq/commit/b2c6bccfabc265c3ed2beb1d677933c67177e90f))

* docs(readme): add feature comparison (#758) ([`60b608d`](https://github.com/taskforcesh/bullmq/commit/60b608db589da0fa82f8edce388525c3d4bca9a8))

### Fix

* fix(flow-producer): use default prefix in add method (#763) fixes #762 ([`fffdb55`](https://github.com/taskforcesh/bullmq/commit/fffdb55f37917776494a4471673ef4564e0faab5))

### Test

* test(compat): fix flaky test when global drained event is emitted (#760) ([`fb25aee`](https://github.com/taskforcesh/bullmq/commit/fb25aee5c17a139d54b7b99549a853d422d6a078))


## v1.47.1 (2021-09-17)

### Chore

* chore(release): 1.47.1 [skip ci]

## [1.47.1](https://github.com/taskforcesh/bullmq/compare/v1.47.0...v1.47.1) (2021-09-17)

### Bug Fixes

* **running:** move running attribute before first async call ([#756](https://github.com/taskforcesh/bullmq/issues/756)) ([f7f0660](https://github.com/taskforcesh/bullmq/commit/f7f066076bbe6cbcbf716ae622d55c6c1ae9b270)) ([`9c2dfab`](https://github.com/taskforcesh/bullmq/commit/9c2dfab132eb3366af69a5c2f1585d4b7150eadb))

### Documentation

* docs(prioritized): rename file (#757) ([`31ba505`](https://github.com/taskforcesh/bullmq/commit/31ba5055983c085019f96c8223fbffe22b88df1c))

### Fix

* fix(running): move running attribute before first async call (#756) ([`f7f0660`](https://github.com/taskforcesh/bullmq/commit/f7f066076bbe6cbcbf716ae622d55c6c1ae9b270))


## v1.47.0 (2021-09-16)

### Chore

* chore(release): 1.47.0 [skip ci]

# [1.47.0](https://github.com/taskforcesh/bullmq/compare/v1.46.7...v1.47.0) (2021-09-16)

### Features

* **queue-events:** launch without launching process ([#750](https://github.com/taskforcesh/bullmq/issues/750)) ([23a2360](https://github.com/taskforcesh/bullmq/commit/23a23606e727ca13b24924a1e867c6b557d6a09d)) ([`7600f1b`](https://github.com/taskforcesh/bullmq/commit/7600f1b4f9c78e0933ab25f6d285381443c07c91))

### Feature

* feat(queue-events): launch without launching process (#750) ([`23a2360`](https://github.com/taskforcesh/bullmq/commit/23a23606e727ca13b24924a1e867c6b557d6a09d))


## v1.46.7 (2021-09-16)

### Chore

* chore(release): 1.46.7 [skip ci]

## [1.46.7](https://github.com/taskforcesh/bullmq/compare/v1.46.6...v1.46.7) (2021-09-16)

### Bug Fixes

* **wait-for-job:** add catch block and emit error ([#749](https://github.com/taskforcesh/bullmq/issues/749)) ([b407f9a](https://github.com/taskforcesh/bullmq/commit/b407f9ac429c825984856eebca58bbfd16feb9d3)) ([`e1cd8bb`](https://github.com/taskforcesh/bullmq/commit/e1cd8bb2b69cb3efff9e6f379462bbefe4e0cf1d))

### Documentation

* docs(retry): increase awareness of needing QueueScheduler instance (#747) ([`99f2efb`](https://github.com/taskforcesh/bullmq/commit/99f2efbca906cb0de4b7673a2886e02423c084c6))

### Fix

* fix(wait-for-job): add catch block and emit error (#749) ([`b407f9a`](https://github.com/taskforcesh/bullmq/commit/b407f9ac429c825984856eebca58bbfd16feb9d3))

### Refactor

* refactor(utils): add handleError (#752) ([`e07afb3`](https://github.com/taskforcesh/bullmq/commit/e07afb3f3873e5d517b4db8737b5af2a9a7f22ad))


## v1.46.6 (2021-09-15)

### Chore

* chore(release): 1.46.6 [skip ci]

## [1.46.6](https://github.com/taskforcesh/bullmq/compare/v1.46.5...v1.46.6) (2021-09-15)

### Bug Fixes

* **connection:** fail only if redis connection does not recover ([#751](https://github.com/taskforcesh/bullmq/issues/751)) ([8d59ced](https://github.com/taskforcesh/bullmq/commit/8d59ced27831a636f40ed4233eba3d4ac0654534)) ([`8dc5463`](https://github.com/taskforcesh/bullmq/commit/8dc54632c55db21231a359f53c43bd89d8db18f3))

### Fix

* fix(connection): fail only if redis connection does not recover (#751) ([`8d59ced`](https://github.com/taskforcesh/bullmq/commit/8d59ced27831a636f40ed4233eba3d4ac0654534))


## v1.46.5 (2021-09-12)

### Chore

* chore(release): 1.46.5 [skip ci]

## [1.46.5](https://github.com/taskforcesh/bullmq/compare/v1.46.4...v1.46.5) (2021-09-12)

### Bug Fixes

* **is-finished:** reject when missing job key ([#746](https://github.com/taskforcesh/bullmq/issues/746)) fixes [#85](https://github.com/taskforcesh/bullmq/issues/85) ([bd49bd2](https://github.com/taskforcesh/bullmq/commit/bd49bd20492676559072e5e16adb6d4e47afb22b)) ([`4b80319`](https://github.com/taskforcesh/bullmq/commit/4b8031963b745334e53e492ae9b028173bb3d0be))

### Fix

* fix(is-finished): reject when missing job key (#746) fixes #85 ([`bd49bd2`](https://github.com/taskforcesh/bullmq/commit/bd49bd20492676559072e5e16adb6d4e47afb22b))


## v1.46.4 (2021-09-10)

### Chore

* chore(release): 1.46.4 [skip ci]

## [1.46.4](https://github.com/taskforcesh/bullmq/compare/v1.46.3...v1.46.4) (2021-09-10)

### Bug Fixes

* **wait-until-finished:** isFinished return failedReason or returnValue ([#743](https://github.com/taskforcesh/bullmq/issues/743)) fixes [#555](https://github.com/taskforcesh/bullmq/issues/555) ([63acae9](https://github.com/taskforcesh/bullmq/commit/63acae98cb083ec978ea17833819d1a21086be33)) ([`1c92551`](https://github.com/taskforcesh/bullmq/commit/1c92551fb6d7dcbca2d12fb8576cd8988cdccb55))

### Fix

* fix(wait-until-finished): isFinished return failedReason or returnValue (#743) fixes #555 ([`63acae9`](https://github.com/taskforcesh/bullmq/commit/63acae98cb083ec978ea17833819d1a21086be33))


## v1.46.3 (2021-09-08)

### Chore

* chore(release): 1.46.3 [skip ci]

## [1.46.3](https://github.com/taskforcesh/bullmq/compare/v1.46.2...v1.46.3) (2021-09-08)

### Bug Fixes

* **add-job:** throw error when missing parent key ([#739](https://github.com/taskforcesh/bullmq/issues/739)) ([d751070](https://github.com/taskforcesh/bullmq/commit/d751070f4ab6553c782341270574ccd253d309b8)) ([`1fab5c2`](https://github.com/taskforcesh/bullmq/commit/1fab5c28c6eace6505b271bb00133f8c59be08ce))

### Fix

* fix(add-job): throw error when missing parent key (#739) ([`d751070`](https://github.com/taskforcesh/bullmq/commit/d751070f4ab6553c782341270574ccd253d309b8))

### Test

* test: cover more lines for coverage (#741) ([`8383b14`](https://github.com/taskforcesh/bullmq/commit/8383b14c6185fb498a110bf61079bdb630345f6d))

* test(nyc): watch src files only (#740) ([`d439631`](https://github.com/taskforcesh/bullmq/commit/d4396318bddac6521cbafed8d7cc87671c92827d))


## v1.46.2 (2021-09-07)

### Chore

* chore(release): 1.46.2 [skip ci]

## [1.46.2](https://github.com/taskforcesh/bullmq/compare/v1.46.1...v1.46.2) (2021-09-07)

### Bug Fixes

* **queue-events:** duplicate connection ([#733](https://github.com/taskforcesh/bullmq/issues/733)) fixes [#726](https://github.com/taskforcesh/bullmq/issues/726) ([e2531ed](https://github.com/taskforcesh/bullmq/commit/e2531ed0c1dc195f210f8cf996e9ffe04c9e4b7d)) ([`8a677ef`](https://github.com/taskforcesh/bullmq/commit/8a677ef958950ca392d97fa4904ea37023605eab))

### Fix

* fix(queue-events): duplicate connection (#733) fixes #726 ([`e2531ed`](https://github.com/taskforcesh/bullmq/commit/e2531ed0c1dc195f210f8cf996e9ffe04c9e4b7d))

### Test

* test: improve some types (#736) ([`ce0646c`](https://github.com/taskforcesh/bullmq/commit/ce0646c578e58003959c2a2a4b2f98d88bed3ebf))


## v1.46.1 (2021-09-06)

### Chore

* chore(release): 1.46.1 [skip ci]

## [1.46.1](https://github.com/taskforcesh/bullmq/compare/v1.46.0...v1.46.1) (2021-09-06)

### Bug Fixes

* **redis-connection:** improve closing fixes [#721](https://github.com/taskforcesh/bullmq/issues/721) ([9d8eb03](https://github.com/taskforcesh/bullmq/commit/9d8eb0306ef5e63c9d34ffd5c96fc15491da639d)) ([`ef9bcc3`](https://github.com/taskforcesh/bullmq/commit/ef9bcc3c80dc3c8705b63d9457397b368d5c611b))

### Fix

* fix(redis-connection): improve closing fixes #721 ([`9d8eb03`](https://github.com/taskforcesh/bullmq/commit/9d8eb0306ef5e63c9d34ffd5c96fc15491da639d))

### Test

* test(flow-producer): add test case using priority option (#735) ([`88c374a`](https://github.com/taskforcesh/bullmq/commit/88c374a10f6eb5cba7d7aa215a3397491f8be697))


## v1.46.0 (2021-09-02)

### Chore

* chore(release): 1.46.0 [skip ci]

# [1.46.0](https://github.com/taskforcesh/bullmq/compare/v1.45.0...v1.46.0) (2021-09-02)

### Features

* **worker:** launch without launching process ([#724](https://github.com/taskforcesh/bullmq/issues/724)) ([af689e4](https://github.com/taskforcesh/bullmq/commit/af689e4e3945b9bc68bfc08c8f0ad57644206c5b)), closes [#436](https://github.com/taskforcesh/bullmq/issues/436) ([`543cae0`](https://github.com/taskforcesh/bullmq/commit/543cae02b5a98a166a942f1f977e02aa0b75058e))

### Feature

* feat(worker): launch without launching process (#724)

re #436 ([`af689e4`](https://github.com/taskforcesh/bullmq/commit/af689e4e3945b9bc68bfc08c8f0ad57644206c5b))


## v1.45.0 (2021-09-02)

### Chore

* chore(release): 1.45.0 [skip ci]

# [1.45.0](https://github.com/taskforcesh/bullmq/compare/v1.44.3...v1.45.0) (2021-09-02)

### Features

* **queue-scheduler:** launch without launching process ([#729](https://github.com/taskforcesh/bullmq/issues/729)) ([f1932a7](https://github.com/taskforcesh/bullmq/commit/f1932a789af13da9b705a72d6f633f984a218862)), closes [#436](https://github.com/taskforcesh/bullmq/issues/436) ([`f13757c`](https://github.com/taskforcesh/bullmq/commit/f13757ca06daa52402371fb2a458a990503c0bff))

### Documentation

* docs(changelog): fix format (#732) ([`45aaa39`](https://github.com/taskforcesh/bullmq/commit/45aaa39241be269fcd68fd59632f47b0b072e80b))

### Feature

* feat(queue-scheduler): launch without launching process (#729)

re #436 ([`f1932a7`](https://github.com/taskforcesh/bullmq/commit/f1932a789af13da9b705a72d6f633f984a218862))


## v1.44.3 (2021-09-02)

### Chore

* chore(release): 1.44.3 [skip ci]

## [1.44.3](https://github.com/taskforcesh/bullmq/compare/v1.44.2...v1.44.3) (2021-09-02)

### Bug Fixes

* **queuescheduler:** handle shared connections fixes [#721](https://github.com/taskforcesh/bullmq/issues/721) ([32a2b2e](https://github.com/taskforcesh/bullmq/commit/32a2b2eccfa3ba1516eacd71e334cae6c787ce4c)) ([`4b551fa`](https://github.com/taskforcesh/bullmq/commit/4b551faaa5b02c572e4f6d36c5d2c2b8c79ff954))

* chore(deps): bump tar from 6.1.3 to 6.1.11 (#728) ([`e4c37fe`](https://github.com/taskforcesh/bullmq/commit/e4c37fec13e85ea69cd2051ed56f03942e4e10e8))

* chore(deps): bump path-parse from 1.0.6 to 1.0.7 (#680) ([`a1845fc`](https://github.com/taskforcesh/bullmq/commit/a1845fcc393ef607401ff72a98916e571c5e33df))

### Fix

* fix(queuescheduler): handle shared connections fixes #721 ([`32a2b2e`](https://github.com/taskforcesh/bullmq/commit/32a2b2eccfa3ba1516eacd71e334cae6c787ce4c))

### Refactor

* refactor(error-codes): add error-codes enum (#716) ([`3070102`](https://github.com/taskforcesh/bullmq/commit/30701023b05d8cd11a1c40dc4098dee882c341d6))

### Test

* test: close instances (#730) ([`f5ff4a7`](https://github.com/taskforcesh/bullmq/commit/f5ff4a756f438676471f06878bcc9c12bf33ba02))

* test: add missing close calls(#725) ([`df27ae9`](https://github.com/taskforcesh/bullmq/commit/df27ae9d11630c4e817c098e5bff70cffcdf5b67))

* test(repeat): restore test (#723) ([`ceaa7de`](https://github.com/taskforcesh/bullmq/commit/ceaa7dece47bbef99c6e289bbfed41860991b4c9))


## v1.44.2 (2021-08-29)

### Chore

* chore(release): 1.44.2 [skip ci]

## [1.44.2](https://github.com/taskforcesh/bullmq/compare/v1.44.1...v1.44.2) (2021-08-29)

### Bug Fixes

* **worker:** use spread operator in processing map keys ([#720](https://github.com/taskforcesh/bullmq/issues/720)) ([32f1e57](https://github.com/taskforcesh/bullmq/commit/32f1e570a9a3369174a228f729f1d1330dcb6965)) ([`c27b97f`](https://github.com/taskforcesh/bullmq/commit/c27b97f5200481b70a6c05131d2fc34db2425d45))

### Fix

* fix(worker): use spread operator in processing map keys (#720) ([`32f1e57`](https://github.com/taskforcesh/bullmq/commit/32f1e570a9a3369174a228f729f1d1330dcb6965))

### Test

* test(repeat): restore skipped test case (#719) ([`d8b1063`](https://github.com/taskforcesh/bullmq/commit/d8b106350ed51a0bb36bb568557a16132aa9e841))

* test: use rejectedWith (#718) ([`3c170f3`](https://github.com/taskforcesh/bullmq/commit/3c170f3cc46ba33ea27c9c308929314d19c4fa9d))


## v1.44.1 (2021-08-29)

### Chore

* chore(release): 1.44.1 [skip ci]

## [1.44.1](https://github.com/taskforcesh/bullmq/compare/v1.44.0...v1.44.1) (2021-08-29)

### Bug Fixes

* **retry:** throw error when retry non failed job ([#717](https://github.com/taskforcesh/bullmq/issues/717)) ([bb9b192](https://github.com/taskforcesh/bullmq/commit/bb9b192e9a1a4f3c25374fcb8c0fb2159eb3f779)) ([`2a8c476`](https://github.com/taskforcesh/bullmq/commit/2a8c4766c674dd132f7592cc9b0b4213b9f33611))

* chore(deps): bump normalize-url from 6.0.0 to 6.0.1 (#587) ([`1e7cef3`](https://github.com/taskforcesh/bullmq/commit/1e7cef36c5ae7d93c86b49e0aa9484dfc470247a))

* chore(deps): upgrade dependencies (#713) ([`ae5cafd`](https://github.com/taskforcesh/bullmq/commit/ae5cafd987d1d494944c850c6317db46292f5a05))

### Documentation

* docs(prioritized): fix typo (#715) ([`919994c`](https://github.com/taskforcesh/bullmq/commit/919994cd4d200e83d77950ca94a44303e634a81a))

### Fix

* fix(retry): throw error when retry non failed job (#717) ([`bb9b192`](https://github.com/taskforcesh/bullmq/commit/bb9b192e9a1a4f3c25374fcb8c0fb2159eb3f779))

### Test

* test: clean redis db after finishing test cases (#714) ([`54f2f2c`](https://github.com/taskforcesh/bullmq/commit/54f2f2c8517ae5484cbcbb472a6ab9ad9ffa4d61))


## v1.44.0 (2021-08-27)

### Chore

* chore(release): 1.44.0 [skip ci]

# [1.44.0](https://github.com/taskforcesh/bullmq/compare/v1.43.0...v1.44.0) (2021-08-27)

### Features

* **queue-events:** add waiting-children event ([#704](https://github.com/taskforcesh/bullmq/issues/704)) ([18b0b79](https://github.com/taskforcesh/bullmq/commit/18b0b7954313274a61fcc058380bfb9d682c059d)) ([`a41952f`](https://github.com/taskforcesh/bullmq/commit/a41952fa8a17441275dd4bf1c675e8a81b4f54a0))

### Documentation

* docs(changelog): fix format (#712) ([`a1c8e00`](https://github.com/taskforcesh/bullmq/commit/a1c8e001431dc516ab74c1c8b054f15dd77634fc))

* docs(queue-events): update progress event typing (#618) ([`8c2f253`](https://github.com/taskforcesh/bullmq/commit/8c2f25382c3673a280210eca487517128279b950))

### Feature

* feat(queue-events): add waiting-children event (#704) ([`18b0b79`](https://github.com/taskforcesh/bullmq/commit/18b0b7954313274a61fcc058380bfb9d682c059d))

### Style

* style(tsdoc): add eslint-plugin-tsdoc ([`25bca3c`](https://github.com/taskforcesh/bullmq/commit/25bca3c6dda8c17ef7172ad1045a4f4de18ce7ab))

### Test

* test(queue-events): add test case when progress receive object ([`c18563f`](https://github.com/taskforcesh/bullmq/commit/c18563f8b670347f0b890f190ab74cabd7dd78cc))

* test(repeat): add test when removeOnComplete is true

re #515 ([`265ff3f`](https://github.com/taskforcesh/bullmq/commit/265ff3fbc5811f2911a1ebafae1825869f9e9283))

### Unknown

* GitBook: [master] one page modified ([`031a3ff`](https://github.com/taskforcesh/bullmq/commit/031a3ff0a4a709733320b6eddd3e26cc2c4c18bc))

* GitBook: [master] 3 pages modified ([`074e7a7`](https://github.com/taskforcesh/bullmq/commit/074e7a7ab7c58a994293e73c6faaf2c37d21efc9))


## v1.43.0 (2021-08-25)

### Chore

* chore(release): 1.43.0 [skip ci]

# [1.43.0](https://github.com/taskforcesh/bullmq/compare/v1.42.1...v1.43.0) (2021-08-25)

### Features

* **events:** add added event when job is created ([#699](https://github.com/taskforcesh/bullmq/issues/699)) ([f533cc5](https://github.com/taskforcesh/bullmq/commit/f533cc55a43cf6ea78a60e85102f15b1c1ff69a0)) ([`dd7efc3`](https://github.com/taskforcesh/bullmq/commit/dd7efc3390e4a9a90f1b3ee0c3e3c74deb1f0369))

* chore: delete comment ([`7df0461`](https://github.com/taskforcesh/bullmq/commit/7df0461b8de3e761b51321ca6de29a26b19e13d2))

### Documentation

* docs(queue): improved queue docs ([`8cdd116`](https://github.com/taskforcesh/bullmq/commit/8cdd1162fdae8c94dead9f2abfbbfb2cf79d416f))

* docs(queue-events): improved queue-events docs ([`bca894a`](https://github.com/taskforcesh/bullmq/commit/bca894acdda6c58a0ba0b00ec4ad97fc7c24de1f))

### Feature

* feat(events): add added event when job is created (#699) ([`f533cc5`](https://github.com/taskforcesh/bullmq/commit/f533cc55a43cf6ea78a60e85102f15b1c1ff69a0))

### Test

* test(mocha): add setup file ([`1324848`](https://github.com/taskforcesh/bullmq/commit/1324848afbfaf7d3fed47ea23da3b519da222b9a))


## v1.42.1 (2021-08-23)

### Chore

* chore(release): 1.42.1 [skip ci]

## [1.42.1](https://github.com/taskforcesh/bullmq/compare/v1.42.0...v1.42.1) (2021-08-23)

### Bug Fixes

* protect emit calls with throw/catch ([79f879b](https://github.com/taskforcesh/bullmq/commit/79f879bf1bca1acea19485def361cc36f1d13b7e)) ([`55606f7`](https://github.com/taskforcesh/bullmq/commit/55606f79cc6accf07d45fe2c4ffa81817108d7bc))

* chore: use spread operator on error emit ([`d911a49`](https://github.com/taskforcesh/bullmq/commit/d911a49f8d160a9ada926aafe101b13a4f61b2b4))

* chore: throw error if missing lua files ([`0ef1671`](https://github.com/taskforcesh/bullmq/commit/0ef16719d02cacdb2bf6834f7cdd9f901bb568c2))

### Documentation

* docs(flow-producer): add NodeOpts documentation ([`b2bcac6`](https://github.com/taskforcesh/bullmq/commit/b2bcac6a49f1e480c0055025a09aecdcff1923df))

* docs(job): apply jsdoc ([`43e0764`](https://github.com/taskforcesh/bullmq/commit/43e076468c6abb2149361344bef8b2b345f3b471))

### Fix

* fix: protect emit calls with throw/catch ([`79f879b`](https://github.com/taskforcesh/bullmq/commit/79f879bf1bca1acea19485def361cc36f1d13b7e))

### Test

* test(events): error event when throwing an error from another event ([`1b59884`](https://github.com/taskforcesh/bullmq/commit/1b598847f8f65dacff6c6cf7239a01eb6253a6b2))


## v1.42.0 (2021-08-20)

### Chore

* chore(release): 1.42.0 [skip ci]

# [1.42.0](https://github.com/taskforcesh/bullmq/compare/v1.41.0...v1.42.0) (2021-08-20)

### Features

* **flows:** add queuesOptions for rate limit ([#692](https://github.com/taskforcesh/bullmq/issues/692)) ([6689ec3](https://github.com/taskforcesh/bullmq/commit/6689ec3fadd21904d9935f932c047f540ed8caf0)), closes [#621](https://github.com/taskforcesh/bullmq/issues/621) ([`f1472da`](https://github.com/taskforcesh/bullmq/commit/f1472dab64c04a7db694a4af3d78f45a96d8922f))

### Feature

* feat(flows): add queuesOptions for rate limit (#692)

re #621 ([`6689ec3`](https://github.com/taskforcesh/bullmq/commit/6689ec3fadd21904d9935f932c047f540ed8caf0))


## v1.41.0 (2021-08-20)

### Chore

* chore(release): 1.41.0 [skip ci]

# [1.41.0](https://github.com/taskforcesh/bullmq/compare/v1.40.4...v1.41.0) (2021-08-20)

### Features

* **flow:** add bulk ([dc59fe6](https://github.com/taskforcesh/bullmq/commit/dc59fe62e57b6e761fe4d2ab6179a69dc4792399)) ([`874b1a4`](https://github.com/taskforcesh/bullmq/commit/874b1a48d1480ee19e57c362f978e13e9f34b1bd))

* chore: delete comment ([`1f6e77e`](https://github.com/taskforcesh/bullmq/commit/1f6e77e4e9c26cfa4f007fa79a3c59fce1e9bbaa))

* chore(flow): remove unneeded updateIds (#684) ([`1b44359`](https://github.com/taskforcesh/bullmq/commit/1b44359ca298dc5195be7046bb5a5c939c91f3cd))

* chore(redis): add docker-compose to support windows development ([`39d42ae`](https://github.com/taskforcesh/bullmq/commit/39d42aefd0ab940006eda05805b9039244ee685a))

### Documentation

* docs: fix typo in bullmq.ratelimiteroptions.md (#683) ([`0190699`](https://github.com/taskforcesh/bullmq/commit/0190699f482705e664b9697223fca6c9fb875484))

* docs(redis): add redis docker-compose instructions for development ([`bee6b75`](https://github.com/taskforcesh/bullmq/commit/bee6b75e982a9b0d3857623cb8e8e3e67662b02c))

### Feature

* feat(flow): add bulk ([`dc59fe6`](https://github.com/taskforcesh/bullmq/commit/dc59fe62e57b6e761fe4d2ab6179a69dc4792399))

### Style

* style(lint): exclude changelog ([`995f281`](https://github.com/taskforcesh/bullmq/commit/995f28138cb9b30dd4d5fee1236230c88aed59ab))

### Test

* test(rate-limit): fix another flaky test ([`24f6a8b`](https://github.com/taskforcesh/bullmq/commit/24f6a8b91f26b571b6983c099f736a3a647909b1))

* test(rate-limit): fix flaky test ([`bb08318`](https://github.com/taskforcesh/bullmq/commit/bb08318fa39efc3ce384828e00a84e9725e2f4af))

### Unknown

* GitBook: [master] one page modified ([`443de32`](https://github.com/taskforcesh/bullmq/commit/443de325afa0cfc35f4ae3e0b0fa718dbd18f13c))

* GitBook: [master] 4 pages modified ([`d441c5e`](https://github.com/taskforcesh/bullmq/commit/d441c5ec2169c606141f4d80fa2d9d13fe30fca5))

* GitBook: [master] 39 pages modified ([`0475e6d`](https://github.com/taskforcesh/bullmq/commit/0475e6d921916385a3e8335c9fcc80cc90796e04))


## v1.40.4 (2021-08-06)

### Chore

* chore(release): 1.40.4 [skip ci]

## [1.40.4](https://github.com/taskforcesh/bullmq/compare/v1.40.3...v1.40.4) (2021-08-06)

### Bug Fixes

* **rate-limiter:** check groupKey is not undefined ([999b918](https://github.com/taskforcesh/bullmq/commit/999b91868814caf4c5c1ddee40798178b71e0ea8)) ([`76dff91`](https://github.com/taskforcesh/bullmq/commit/76dff919c89b6eef13bd3109d5b84c89436f427a))

### Fix

* fix(rate-limiter): check groupKey is not undefined ([`999b918`](https://github.com/taskforcesh/bullmq/commit/999b91868814caf4c5c1ddee40798178b71e0ea8))

### Test

* test(rate-limiter): add test case when missing groupKey ([`1cf58d1`](https://github.com/taskforcesh/bullmq/commit/1cf58d188f48b76f531ccc7f96736a5ce6084d7f))


## v1.40.3 (2021-08-06)

### Chore

* chore(release): 1.40.3 [skip ci]

## [1.40.3](https://github.com/taskforcesh/bullmq/compare/v1.40.2...v1.40.3) (2021-08-06)

### Bug Fixes

* **redis-connection:** add error event in waitUntilReady ([ac4101e](https://github.com/taskforcesh/bullmq/commit/ac4101e3e798110c022d6c9f10f3b98f5e86b151)) ([`40f9d14`](https://github.com/taskforcesh/bullmq/commit/40f9d14f6ff6d64664748eb723d3a827bd2de337))

* chore(deps): bump tar from 6.1.0 to 6.1.3

Bumps [tar](https://github.com/npm/node-tar) from 6.1.0 to 6.1.3.
- [Release notes](https://github.com/npm/node-tar/releases)
- [Changelog](https://github.com/npm/node-tar/blob/main/CHANGELOG.md)
- [Commits](https://github.com/npm/node-tar/compare/v6.1.0...v6.1.3)

---
updated-dependencies:
- dependency-name: tar
  dependency-type: indirect
...

Signed-off-by: dependabot[bot] &lt;support@github.com&gt; ([`242ed66`](https://github.com/taskforcesh/bullmq/commit/242ed664fdbd3dab58a363d886b63a56bc024170))

### Fix

* fix(redis-connection): add error event in waitUntilReady ([`ac4101e`](https://github.com/taskforcesh/bullmq/commit/ac4101e3e798110c022d6c9f10f3b98f5e86b151))

### Style

* style: use string template ([`9872ce1`](https://github.com/taskforcesh/bullmq/commit/9872ce1c3a52bd9ff0325d9c929f5554ed260c96))


## v1.40.2 (2021-08-06)

### Chore

* chore(release): 1.40.2 [skip ci]

## [1.40.2](https://github.com/taskforcesh/bullmq/compare/v1.40.1...v1.40.2) (2021-08-06)

### Bug Fixes

* move clientCommandMessageReg to utils ([dd5d555](https://github.com/taskforcesh/bullmq/commit/dd5d5553fe768eb18b17b53c7f75e7066024e382)) ([`5a83df7`](https://github.com/taskforcesh/bullmq/commit/5a83df7fac77ee5dac4e97813f5feaaf0b3246b8))

### Documentation

* docs(changelog): fix formatting ([`7a41a1c`](https://github.com/taskforcesh/bullmq/commit/7a41a1ced66dbcf3ac3c71f95d446214a51647ff))

### Fix

* fix: move clientCommandMessageReg to utils ([`dd5d555`](https://github.com/taskforcesh/bullmq/commit/dd5d5553fe768eb18b17b53c7f75e7066024e382))

### Refactor

* refactor: move getParentKey into utils ([`2c5baf0`](https://github.com/taskforcesh/bullmq/commit/2c5baf0cd2842ac37284fb387a78b9fe2942d2f4))


## v1.40.1 (2021-07-24)

### Chore

* chore(release): 1.40.1 [skip ci]

## [1.40.1](https://github.com/taskforcesh/bullmq/compare/v1.40.0...v1.40.1) (2021-07-24)

### Bug Fixes

* connection hangs with failed connection fixes [#656](https://github.com/taskforcesh/bullmq/issues/656) ([c465611](https://github.com/taskforcesh/bullmq/commit/c465611ed76afd2adfd0e05a8babd6e369f5c310)) ([`e2502ca`](https://github.com/taskforcesh/bullmq/commit/e2502ca390aff42d8580474376492b80a273bae3))

### Fix

* fix: connection hangs with failed connection fixes #656 ([`c465611`](https://github.com/taskforcesh/bullmq/commit/c465611ed76afd2adfd0e05a8babd6e369f5c310))

### Refactor

* refactor: import CONNECTION_CLOSED_ERROR_MSG from ioredis

It&#39;s possible to import `CONNECTION_CLOSED_ERROR_MSG` from `ioredis`, but it isn&#39;t available on the main export and isn&#39;t defined in the library type declarations. ([`f217219`](https://github.com/taskforcesh/bullmq/commit/f217219bc3b37de375bf44511acdf94f85b31e32))


## v1.40.0 (2021-07-22)

### Chore

* chore(release): 1.40.0 [skip ci]

# [1.40.0](https://github.com/taskforcesh/bullmq/compare/v1.39.5...v1.40.0) (2021-07-22)

### Features

* **worker:** retry with delay errors in run loop ([409fe7f](https://github.com/taskforcesh/bullmq/commit/409fe7fc09b87b7916a3362a463bb9e0f17ecea8)) ([`a4984ee`](https://github.com/taskforcesh/bullmq/commit/a4984ee9b3afb5c999fcef6f60b07279e85770a6))

* chore: simplify retryIfFailed ([`3eff55b`](https://github.com/taskforcesh/bullmq/commit/3eff55b8e847db6134f7bbe5045922e59a27647a))

### Documentation

* docs(worker): add more documentation to Worker methods ([`3dbe652`](https://github.com/taskforcesh/bullmq/commit/3dbe6526ad1314264f0dc722f0297c3aba38fc4e))

* docs: add missing changelog items ([`6e96c25`](https://github.com/taskforcesh/bullmq/commit/6e96c2566da0c9c2072aee5cbcc49b9c67907c2c))

* docs(changelog): change symbolic link ([`01ac146`](https://github.com/taskforcesh/bullmq/commit/01ac1462ef4cd7504b0c37e3366c8bc5c3070a2b))

* docs(changelog): fix config ([`a60a530`](https://github.com/taskforcesh/bullmq/commit/a60a530971cf3a810a3430ce8cd837e621ea5e47))

* docs: deleted uppercased CHANGELOG ([`6c7ec18`](https://github.com/taskforcesh/bullmq/commit/6c7ec18b562abb2e9646b21b05a722f2d849beb3))

### Feature

* feat(worker): retry with delay errors in run loop ([`409fe7f`](https://github.com/taskforcesh/bullmq/commit/409fe7fc09b87b7916a3362a463bb9e0f17ecea8))


## v1.39.5 (2021-07-21)

### Chore

* chore(release): 1.39.5 [skip ci]

## [1.39.5](https://github.com/taskforcesh/bullmq/compare/v1.39.4...v1.39.5) (2021-07-21)

### Bug Fixes

* **move-to-finished:** remove stalled jobs when finishing ([3867126](https://github.com/taskforcesh/bullmq/commit/38671261ccc00ca7fefa677663e45a40a92df555)) ([`4000c34`](https://github.com/taskforcesh/bullmq/commit/4000c34716609ca60c324635c4850bbe5c363b90))

* chore: use string templates ([`01b9d45`](https://github.com/taskforcesh/bullmq/commit/01b9d45e6096c065e34415765375f81cf0d06fe6))

### Fix

* fix(move-to-finished): remove stalled jobs when finishing ([`3867126`](https://github.com/taskforcesh/bullmq/commit/38671261ccc00ca7fefa677663e45a40a92df555))


## v1.39.4 (2021-07-21)

### Chore

* chore(release): 1.39.4 [skip ci]

## [1.39.4](https://github.com/taskforcesh/bullmq/compare/v1.39.3...v1.39.4) (2021-07-21)

### Bug Fixes

* **repeatable:** validate endDate when adding next repeatable job ([1324cbb](https://github.com/taskforcesh/bullmq/commit/1324cbb4effd55e98c29d95a21afca7cd045b46c)) ([`a6eefeb`](https://github.com/taskforcesh/bullmq/commit/a6eefebfb33aaa376e241c27ff242adb6a78e44b))

### Fix

* fix(repeatable): validate endDate when adding next repeatable job ([`1324cbb`](https://github.com/taskforcesh/bullmq/commit/1324cbb4effd55e98c29d95a21afca7cd045b46c))


## v1.39.3 (2021-07-16)

### Chore

* chore(release): 1.39.3 [skip ci]

## [1.39.3](https://github.com/taskforcesh/bullmq/compare/v1.39.2...v1.39.3) (2021-07-16)

### Bug Fixes

* connect if redis client has status &#34;wait&#34; ([f711717](https://github.com/taskforcesh/bullmq/commit/f711717f56822aef43c9fd0440e30fad0876ba62)) ([`6774a2a`](https://github.com/taskforcesh/bullmq/commit/6774a2a6dd061055ef470229e43e896754e06c64))

### Fix

* fix: connect if redis client has status &#34;wait&#34;

Summary: When supplying your own IORedis instance and `lazyConnect` is true, the RedisConnection instance will not connect on its own because it does not check if it&#39;s `status` is &#34;wait&#34;. While this may be intended behavior, there is no direct way to call `connect` on the duplicated Redis instance causing it to never connect and indefinitely wait until ready. ([`f711717`](https://github.com/taskforcesh/bullmq/commit/f711717f56822aef43c9fd0440e30fad0876ba62))


## v1.39.2 (2021-07-15)

### Chore

* chore(release): 1.39.2 [skip ci]

## [1.39.2](https://github.com/taskforcesh/bullmq/compare/v1.39.1...v1.39.2) (2021-07-15)

### Bug Fixes

* **queue:** ensure the Queue constructor doesn&#39;t try to set queue options if the client is closed ([b40c6eb](https://github.com/taskforcesh/bullmq/commit/b40c6eb931a71d0ae9f6454eb70d84259a6981b7)) ([`451365c`](https://github.com/taskforcesh/bullmq/commit/451365ce939e43e71fd45c3614103ad409c8a90d))

### Fix

* fix(queue): ensure the Queue constructor doesn&#39;t try to set queue options if the client is closed

In my app we disconnect queues sometimes quite quickly after constructing them, and see this error every so often in our CI logs:

```
/app/node_modules/bullmq/node_modules/ioredis/built/redis/index.js:620
        command.reject(new Error(utils_1.CONNECTION_CLOSED_ERROR_MSG));
                       ^
Error: Connection is closed.
    at Redis.sendCommand (/app/node_modules/bullmq/node_modules/ioredis/built/redis/index.js:620:24)
    at Redis.hset (/app/node_modules/bullmq/node_modules/ioredis/built/commander.js:111:25)
    at /app/node_modules/bullmq/src/classes/queue.ts:29:14
```

I am not exactly sure why it only happens sometimes but not others, but regardless, I think it&#39;s a good idea not to try to run the floating `hset` in the queue constructor if the client has been closed. This prevents that by first checking if the client has been closed before doing this floating work. ([`b40c6eb`](https://github.com/taskforcesh/bullmq/commit/b40c6eb931a71d0ae9f6454eb70d84259a6981b7))


## v1.39.1 (2021-07-15)

### Chore

* chore(release): 1.39.1 [skip ci]

## [1.39.1](https://github.com/taskforcesh/bullmq/compare/v1.39.0...v1.39.1) (2021-07-15)

### Bug Fixes

* **sandbox:** use updateProgress method name ([27d62c3](https://github.com/taskforcesh/bullmq/commit/27d62c32b2fac091b2700d6077de593c9fda4c22)) ([`a3bdce2`](https://github.com/taskforcesh/bullmq/commit/a3bdce292486b983305e6e324427adee9d4199ef))

### Fix

* fix(sandbox): use updateProgress method name ([`27d62c3`](https://github.com/taskforcesh/bullmq/commit/27d62c32b2fac091b2700d6077de593c9fda4c22))

### Unknown

* GitBook: [master] one page modified ([`7299935`](https://github.com/taskforcesh/bullmq/commit/72999351fedb5edb0ea6742e1cb7610e9cfff406))

* GitBook: [master] 8 pages modified ([`c37b009`](https://github.com/taskforcesh/bullmq/commit/c37b0092cd2842a4479fc0726e79eadea39f6ce2))


## v1.39.0 (2021-07-13)

### Chore

* chore(release): 1.39.0 [skip ci]

# [1.39.0](https://github.com/taskforcesh/bullmq/compare/v1.38.1...v1.39.0) (2021-07-13)

### Features

* **worker+scheduler:** add a &#34;running&#34; attribute for healthchecking ([aae358e](https://github.com/taskforcesh/bullmq/commit/aae358e067a0b6f20124751cffcdeaebac6eb7fd)) ([`c718d36`](https://github.com/taskforcesh/bullmq/commit/c718d365d0a1882154130d096988f3294fe8c66f))

### Feature

* feat(worker+scheduler): add a &#34;running&#34; attribute for healthchecking ([`aae358e`](https://github.com/taskforcesh/bullmq/commit/aae358e067a0b6f20124751cffcdeaebac6eb7fd))


## v1.38.1 (2021-07-12)

### Chore

* chore(release): 1.38.1 [skip ci]

## [1.38.1](https://github.com/taskforcesh/bullmq/compare/v1.38.0...v1.38.1) (2021-07-12)

### Bug Fixes

* **reprocess:** do not store job.id in added list ([9c0605e](https://github.com/taskforcesh/bullmq/commit/9c0605e10f0bbdce94153d3f318d56c23bfd3269)) ([`9a4e496`](https://github.com/taskforcesh/bullmq/commit/9a4e496489b292821c746d14f413aff25f134bfd))

### Fix

* fix(reprocess): do not store job.id in added list ([`9c0605e`](https://github.com/taskforcesh/bullmq/commit/9c0605e10f0bbdce94153d3f318d56c23bfd3269))


## v1.38.0 (2021-07-12)

### Chore

* chore(release): 1.38.0 [skip ci]

# [1.38.0](https://github.com/taskforcesh/bullmq/compare/v1.37.1...v1.38.0) (2021-07-12)

### Features

* **queue:** add missing events typings ([b42e78c](https://github.com/taskforcesh/bullmq/commit/b42e78c36cb6a6579a4c7cce1d7e969b230ff5b6)) ([`c234af2`](https://github.com/taskforcesh/bullmq/commit/c234af2ae548c4bed6ed6553a368c555d65b249e))

### Feature

* feat(queue): add missing events typings ([`b42e78c`](https://github.com/taskforcesh/bullmq/commit/b42e78c36cb6a6579a4c7cce1d7e969b230ff5b6))


## v1.37.1 (2021-07-02)

### Chore

* chore(release): 1.37.1 [skip ci]

## [1.37.1](https://github.com/taskforcesh/bullmq/compare/v1.37.0...v1.37.1) (2021-07-02)

### Bug Fixes

* **stalled-jobs:** move stalled jobs to wait in batches ([a23fcb8](https://github.com/taskforcesh/bullmq/commit/a23fcb82d4ca20cbc4b8cd8b544b2d2eaddd86c3)), closes [#422](https://github.com/taskforcesh/bullmq/issues/422) ([`ff8cde6`](https://github.com/taskforcesh/bullmq/commit/ff8cde6cb8ed13d6bca19802348979caa3669ee6))

### Fix

* fix(stalled-jobs): move stalled jobs to wait in batches

re #422 ([`a23fcb8`](https://github.com/taskforcesh/bullmq/commit/a23fcb82d4ca20cbc4b8cd8b544b2d2eaddd86c3))


## v1.37.0 (2021-06-30)

### Chore

* chore(release): 1.37.0 [skip ci]

# [1.37.0](https://github.com/taskforcesh/bullmq/compare/v1.36.1...v1.37.0) (2021-06-30)

### Features

* **job:** add changeDelay method for delayed jobs ([f0a9f9c](https://github.com/taskforcesh/bullmq/commit/f0a9f9c6479062413abc0ac9a6f744329571a618)) ([`57f95e0`](https://github.com/taskforcesh/bullmq/commit/57f95e078eb8176973eea0670c56c9f2e3ec524c))

* chore(deps): add commitizen

this is a helper for semantic-release commit messages ([`eacd59b`](https://github.com/taskforcesh/bullmq/commit/eacd59bd67b7c356614d9acd2cc59a8b92f9b396))

### Documentation

* docs: remove poll ([`990497a`](https://github.com/taskforcesh/bullmq/commit/990497a8c427b4804c8c1fcccf23f213ee4bb047))

* docs(contributing): rephrase some sections ([`16529c2`](https://github.com/taskforcesh/bullmq/commit/16529c2a9fb5df5cffa02106ccc631ac16e43ae4))

* docs(readme): add contributing reference ([`c7bc38b`](https://github.com/taskforcesh/bullmq/commit/c7bc38b47f8e8a74a3c5348dd987baa3effbd048))

### Feature

* feat(job): add changeDelay method for delayed jobs ([`f0a9f9c`](https://github.com/taskforcesh/bullmq/commit/f0a9f9c6479062413abc0ac9a6f744329571a618))


## v1.36.1 (2021-06-22)

### Chore

* chore(release): 1.36.1 [skip ci]

## [1.36.1](https://github.com/taskforcesh/bullmq/compare/v1.36.0...v1.36.1) (2021-06-22)

### Bug Fixes

* **worker:** change active event typing ([220b4f6](https://github.com/taskforcesh/bullmq/commit/220b4f619b30a8f04979e9abd0139e46d89b424d)) ([`5bed98a`](https://github.com/taskforcesh/bullmq/commit/5bed98aa4204d6e6cf7d17233b6ea2d4ab9fcb3c))

### Fix

* fix(worker): change active event typing ([`220b4f6`](https://github.com/taskforcesh/bullmq/commit/220b4f619b30a8f04979e9abd0139e46d89b424d))


## v1.36.0 (2021-06-20)

### Chore

* chore(release): 1.36.0 [skip ci]

# [1.36.0](https://github.com/taskforcesh/bullmq/compare/v1.35.0...v1.36.0) (2021-06-20)

### Bug Fixes

* **queue-events:** fix drained typing ([9cf711d](https://github.com/taskforcesh/bullmq/commit/9cf711d4d4e7d8214dfd93a243c35d0bf135cdaf))

### Features

* **worker:** add active event typing ([5508cdf](https://github.com/taskforcesh/bullmq/commit/5508cdf7cf372ae2f4af0ef576016eb901580671))
* **worker:** add progress event typing ([119cb7c](https://github.com/taskforcesh/bullmq/commit/119cb7cd7a91c0f1866f5957faf2850afadbe709)) ([`8d40ddb`](https://github.com/taskforcesh/bullmq/commit/8d40ddbaf1f48dc08e459e085fbe196361bba9a3))

### Documentation

* docs: add keywords ([`071fec2`](https://github.com/taskforcesh/bullmq/commit/071fec2eae89fbb347dc9f51eac0a357ae509f49))

### Feature

* feat(worker): add active event typing ([`5508cdf`](https://github.com/taskforcesh/bullmq/commit/5508cdf7cf372ae2f4af0ef576016eb901580671))

* feat(worker): add progress event typing ([`119cb7c`](https://github.com/taskforcesh/bullmq/commit/119cb7cd7a91c0f1866f5957faf2850afadbe709))

### Fix

* fix(queue-events): fix drained typing ([`9cf711d`](https://github.com/taskforcesh/bullmq/commit/9cf711d4d4e7d8214dfd93a243c35d0bf135cdaf))


## v1.35.0 (2021-06-19)

### Chore

* chore(release): 1.35.0 [skip ci]

# [1.35.0](https://github.com/taskforcesh/bullmq/compare/v1.34.2...v1.35.0) (2021-06-19)

### Features

* **worker:** add drained event typing ([ed5f315](https://github.com/taskforcesh/bullmq/commit/ed5f3155415693d2a6dbfb779397d53d74b704e2)) ([`499fe50`](https://github.com/taskforcesh/bullmq/commit/499fe5088aba2f265213b730fd79f3ad6f63b1b9))

### Feature

* feat(worker): add drained event typing ([`ed5f315`](https://github.com/taskforcesh/bullmq/commit/ed5f3155415693d2a6dbfb779397d53d74b704e2))


## v1.34.2 (2021-06-18)

### Chore

* chore(release): 1.34.2 [skip ci]

## [1.34.2](https://github.com/taskforcesh/bullmq/compare/v1.34.1...v1.34.2) (2021-06-18)

### Bug Fixes

* **worker:** await for processing functions ([0566804](https://github.com/taskforcesh/bullmq/commit/056680470283f134b447a8ba39afa29e1e113585)) ([`4882e01`](https://github.com/taskforcesh/bullmq/commit/4882e01379efad9b3fe7bff48bb7fbe70f115873))

### Fix

* fix(worker): await for processing functions ([`0566804`](https://github.com/taskforcesh/bullmq/commit/056680470283f134b447a8ba39afa29e1e113585))


## v1.34.1 (2021-06-18)

### Chore

* chore(release): 1.34.1 [skip ci]

## [1.34.1](https://github.com/taskforcesh/bullmq/compare/v1.34.0...v1.34.1) (2021-06-18)

### Bug Fixes

* **redis-connection:** remove error event listener from client ([2d70fe7](https://github.com/taskforcesh/bullmq/commit/2d70fe7cc7d43673674ec2ba0204c10661b34e95)) ([`2b21440`](https://github.com/taskforcesh/bullmq/commit/2b21440f5befd4b95d6be3d8e8235b31279ce0c6))

### Documentation

* docs(flow-producer): fix typo on getFlow ([`f6e163e`](https://github.com/taskforcesh/bullmq/commit/f6e163e3430a0e38d671730313ba9157ef93f85b))

* docs: add example of adding retry rules to queue&#39;s default options ([`1f53172`](https://github.com/taskforcesh/bullmq/commit/1f53172351b81dff9b3d4dc6daa83de6d8249dec))

### Fix

* fix(redis-connection): remove error event listener from client ([`2d70fe7`](https://github.com/taskforcesh/bullmq/commit/2d70fe7cc7d43673674ec2ba0204c10661b34e95))

### Test

* test(mocha): no exclusive tests ([`2e9af30`](https://github.com/taskforcesh/bullmq/commit/2e9af3071f445a7118823dfeb79d8eb355ba5def))


## v1.34.0 (2021-06-11)

### Chore

* chore(release): 1.34.0 [skip ci]

# [1.34.0](https://github.com/taskforcesh/bullmq/compare/v1.33.1...v1.34.0) (2021-06-11)

### Features

* **job:** expose queueName ([8683bd4](https://github.com/taskforcesh/bullmq/commit/8683bd470cc7304f087d646fd40c5bc3acc1263c)) ([`a3342b2`](https://github.com/taskforcesh/bullmq/commit/a3342b2aa23ed0606fe97f4aeadad5263038a703))

### Documentation

* docs: define exponential and fixed backoffs ([`d621359`](https://github.com/taskforcesh/bullmq/commit/d62135967e1d9a8c001faddde42238e4e96e5212))

### Feature

* feat(job): expose queueName ([`8683bd4`](https://github.com/taskforcesh/bullmq/commit/8683bd470cc7304f087d646fd40c5bc3acc1263c))


## v1.33.1 (2021-06-10)

### Chore

* chore(release): 1.33.1 [skip ci]

## [1.33.1](https://github.com/taskforcesh/bullmq/compare/v1.33.0...v1.33.1) (2021-06-10)

### Bug Fixes

* **job:** destructure default opts for pagination ([73363a5](https://github.com/taskforcesh/bullmq/commit/73363a551f56608f8936ad1f730d0a9c778aafd2)) ([`7dfb343`](https://github.com/taskforcesh/bullmq/commit/7dfb343219737c1a3bef72c5121803b4e7e4fdd6))

### Fix

* fix(job): destructure default opts for pagination ([`73363a5`](https://github.com/taskforcesh/bullmq/commit/73363a551f56608f8936ad1f730d0a9c778aafd2))

### Test

* test: add missing test case for processed pagination ([`2631c21`](https://github.com/taskforcesh/bullmq/commit/2631c214b843b60224557418f1d69a2ea8dc87d5))


## v1.33.0 (2021-06-10)

### Chore

* chore(release): 1.33.0 [skip ci]

# [1.33.0](https://github.com/taskforcesh/bullmq/compare/v1.32.0...v1.33.0) (2021-06-10)

### Features

* **job:** add getDependenciesCount method ([ae39a4c](https://github.com/taskforcesh/bullmq/commit/ae39a4c77a958242cb445dbb32ae27b15a953653)) ([`a4efbb5`](https://github.com/taskforcesh/bullmq/commit/a4efbb57e29315b7255780569ef2c6c11b4dad6d))

* chore: delete .only ([`4a3b789`](https://github.com/taskforcesh/bullmq/commit/4a3b78920514b707ddbdab20293d656284d91735))

### Documentation

* docs(queue-options): fix typo ([`8db639b`](https://github.com/taskforcesh/bullmq/commit/8db639b9e62706ea70ba847c6c49b1244c260e54))

### Test

* test(worker): fix flaky test related to getDependencies ([`f512823`](https://github.com/taskforcesh/bullmq/commit/f512823a847d7a464cf7253fed3fad2563945fbc))

### Unknown

*  feat(job): add getDependenciesCount method ([`ae39a4c`](https://github.com/taskforcesh/bullmq/commit/ae39a4c77a958242cb445dbb32ae27b15a953653))


## v1.32.0 (2021-06-07)

### Chore

* chore(release): 1.32.0 [skip ci]

# [1.32.0](https://github.com/taskforcesh/bullmq/compare/v1.31.1...v1.32.0) (2021-06-07)

### Features

* **flow-producer:** add getFlow method ([ce93d04](https://github.com/taskforcesh/bullmq/commit/ce93d04c962686aff34f670f2decadadbf1cf4ca)) ([`87b3603`](https://github.com/taskforcesh/bullmq/commit/87b360323ed3ab4d43ccd3e278413137479cdf3b))

### Feature

* feat(flow-producer): add getFlow method ([`ce93d04`](https://github.com/taskforcesh/bullmq/commit/ce93d04c962686aff34f670f2decadadbf1cf4ca))


## v1.31.1 (2021-06-07)

### Chore

* chore(release): 1.31.1 [skip ci]

## [1.31.1](https://github.com/taskforcesh/bullmq/compare/v1.31.0...v1.31.1) (2021-06-07)

### Bug Fixes

* **worker:** remove processed key when removeOnComplete ([4ec1b73](https://github.com/taskforcesh/bullmq/commit/4ec1b739d6aeeb2fc21887b58f5978027ddcdb50)) ([`7068d4c`](https://github.com/taskforcesh/bullmq/commit/7068d4c2297468714ce1034b16bc9a32e9571d70))

* chore(deps): upgrade ioredis to 4.27.5 ([`f538f5b`](https://github.com/taskforcesh/bullmq/commit/f538f5bd760570b6cc3078083b685988d6e42bc4))

### Documentation

* docs(compat): fix typos ([`f9c5c3c`](https://github.com/taskforcesh/bullmq/commit/f9c5c3c54338eedf1385864f0580cc8d83cea388))

### Fix

* fix(worker): remove processed key when removeOnComplete ([`4ec1b73`](https://github.com/taskforcesh/bullmq/commit/4ec1b739d6aeeb2fc21887b58f5978027ddcdb50))


## v1.31.0 (2021-06-04)

### Chore

* chore(release): 1.31.0 [skip ci]

# [1.31.0](https://github.com/taskforcesh/bullmq/compare/v1.30.2...v1.31.0) (2021-06-04)

### Features

* **job:** extend getDependencies to support pagination ([9b61bbb](https://github.com/taskforcesh/bullmq/commit/9b61bbb9160358f629cd458fa8dc4c9b6ebcd9f5)) ([`d8c67c2`](https://github.com/taskforcesh/bullmq/commit/d8c67c26483c1e38554abdbde240a29b90f1766a))

### Feature

* feat(job): extend getDependencies to support pagination ([`9b61bbb`](https://github.com/taskforcesh/bullmq/commit/9b61bbb9160358f629cd458fa8dc4c9b6ebcd9f5))


## v1.30.2 (2021-06-03)

### Chore

* chore(release): 1.30.2 [skip ci]

## [1.30.2](https://github.com/taskforcesh/bullmq/compare/v1.30.1...v1.30.2) (2021-06-03)

### Bug Fixes

* **job:** parse results in getDependencies for processed jobs ([6fdc701](https://github.com/taskforcesh/bullmq/commit/6fdc7011ba910e5ca9c6d87926cc523ef38ef3ca)) ([`d3335ce`](https://github.com/taskforcesh/bullmq/commit/d3335cee83c3ad93a36066b06111a350b34d0621))

### Unknown

*  fix(job): parse results in getDependencies for processed jobs ([`6fdc701`](https://github.com/taskforcesh/bullmq/commit/6fdc7011ba910e5ca9c6d87926cc523ef38ef3ca))


## v1.30.1 (2021-06-02)

### Chore

* chore(release): 1.30.1 [skip ci]

## [1.30.1](https://github.com/taskforcesh/bullmq/compare/v1.30.0...v1.30.1) (2021-06-02)

### Bug Fixes

* **move-to-waiting-children:** make opts optional ([33bd76a](https://github.com/taskforcesh/bullmq/commit/33bd76a2cac9be450b5d76c6cfe16751c7569ceb)) ([`46e35c3`](https://github.com/taskforcesh/bullmq/commit/46e35c39141573daf0401c8ab79957c84424f1a7))

### Fix

* fix(move-to-waiting-children): make opts optional ([`33bd76a`](https://github.com/taskforcesh/bullmq/commit/33bd76a2cac9be450b5d76c6cfe16751c7569ceb))


## v1.30.0 (2021-06-02)

### Chore

* chore(release): 1.30.0 [skip ci]

# [1.30.0](https://github.com/taskforcesh/bullmq/compare/v1.29.1...v1.30.0) (2021-06-02)

### Features

* add some event typing ([934c004](https://github.com/taskforcesh/bullmq/commit/934c0040b0802bb67f44a979584405d795a8ab5e)) ([`bf17c7b`](https://github.com/taskforcesh/bullmq/commit/bf17c7bf5b30e6c9c566e565400aa0c8f32220ab))

### Feature

* feat: add some event typing ([`934c004`](https://github.com/taskforcesh/bullmq/commit/934c0040b0802bb67f44a979584405d795a8ab5e))


## v1.29.1 (2021-05-31)

### Chore

* chore(release): 1.29.1 [skip ci]

## [1.29.1](https://github.com/taskforcesh/bullmq/compare/v1.29.0...v1.29.1) (2021-05-31)

### Bug Fixes

* **move-stalled-jobs-to-wait:** send failedReason to queueEvents ([7c510b5](https://github.com/taskforcesh/bullmq/commit/7c510b542558bd4b1330371b73331f37b97a818d)) ([`2b43133`](https://github.com/taskforcesh/bullmq/commit/2b43133875ed67189ca9f6cf1222bf726a941a85))

### Fix

* fix(move-stalled-jobs-to-wait): send failedReason to queueEvents ([`7c510b5`](https://github.com/taskforcesh/bullmq/commit/7c510b542558bd4b1330371b73331f37b97a818d))


## v1.29.0 (2021-05-31)

### Chore

* chore(release): 1.29.0 [skip ci]

# [1.29.0](https://github.com/taskforcesh/bullmq/compare/v1.28.2...v1.29.0) (2021-05-31)

### Features

* add move to waiting children for manual processing ([#477](https://github.com/taskforcesh/bullmq/issues/477)) ([f312f29](https://github.com/taskforcesh/bullmq/commit/f312f293b8cac79af9c14848ffd1b11b65a806c3)) ([`00a8352`](https://github.com/taskforcesh/bullmq/commit/00a8352c7e772df7f0a42812a330b98e50f45de3))

### Feature

* feat: add move to waiting children for manual processing (#477) ([`f312f29`](https://github.com/taskforcesh/bullmq/commit/f312f293b8cac79af9c14848ffd1b11b65a806c3))


## v1.28.2 (2021-05-31)

### Chore

* chore(release): 1.28.2 [skip ci]

## [1.28.2](https://github.com/taskforcesh/bullmq/compare/v1.28.1...v1.28.2) (2021-05-31)

### Bug Fixes

* **obliterate:** remove job logs ([ea91895](https://github.com/taskforcesh/bullmq/commit/ea918950d7696241047a23773cc13cd675209c4b)) ([`499bb93`](https://github.com/taskforcesh/bullmq/commit/499bb93c303052af0a2629dbaddd8916dc020fc4))

### Fix

* fix(obliterate): remove job logs ([`ea91895`](https://github.com/taskforcesh/bullmq/commit/ea918950d7696241047a23773cc13cd675209c4b))


## v1.28.1 (2021-05-31)

### Chore

* chore(release): 1.28.1 [skip ci]

## [1.28.1](https://github.com/taskforcesh/bullmq/compare/v1.28.0...v1.28.1) (2021-05-31)

### Bug Fixes

* **get-workers:** use strict equality on name fixes [#564](https://github.com/taskforcesh/bullmq/issues/564) ([4becfa6](https://github.com/taskforcesh/bullmq/commit/4becfa66e09dacf9830804898c45cb3317dcf438)) ([`f8c3a37`](https://github.com/taskforcesh/bullmq/commit/f8c3a3793d25696fd472ad963441836529f356e7))

### Documentation

* docs(job): fix timestamp typo ([`de37977`](https://github.com/taskforcesh/bullmq/commit/de37977e517b7f6b9aa2efe642169a840aeb4e1a))

* docs: update readme ([`6442798`](https://github.com/taskforcesh/bullmq/commit/644279813fc6a5e1838ac18cc1f16aae5fee2723))

### Unknown

*  fix(get-workers): use strict equality on name fixes #564 ([`4becfa6`](https://github.com/taskforcesh/bullmq/commit/4becfa66e09dacf9830804898c45cb3317dcf438))


## v1.28.0 (2021-05-24)

### Chore

* chore(release): 1.28.0 [skip ci]

# [1.28.0](https://github.com/taskforcesh/bullmq/compare/v1.27.0...v1.28.0) (2021-05-24)

### Features

* **flow-producer:** expose client connection ([17d4263](https://github.com/taskforcesh/bullmq/commit/17d4263abfa57797535cd8773c4cc316ff5149d2)) ([`a3aa689`](https://github.com/taskforcesh/bullmq/commit/a3aa6892fde7fd81e3ad78d664ffd29bca6be249))

### Documentation

* docs: document some job methods ([`fd203ea`](https://github.com/taskforcesh/bullmq/commit/fd203ea696cc72e1df823b3ee033617bd6cfff87))

### Feature

* feat(flow-producer): expose client connection ([`17d4263`](https://github.com/taskforcesh/bullmq/commit/17d4263abfa57797535cd8773c4cc316ff5149d2))


## v1.27.0 (2021-05-24)

### Chore

* chore(release): 1.27.0 [skip ci]

# [1.27.0](https://github.com/taskforcesh/bullmq/compare/v1.26.5...v1.27.0) (2021-05-24)

### Features

* **repeat:** add immediately opt for repeat ([d095573](https://github.com/taskforcesh/bullmq/commit/d095573f8e7ce5911f777df48368382eceb99d6a)) ([`9bad41e`](https://github.com/taskforcesh/bullmq/commit/9bad41e6947f1b16e33839742f055b6c5c2c5bc5))

### Documentation

* docs: replace survey link ([`a4a2f46`](https://github.com/taskforcesh/bullmq/commit/a4a2f468dc2bdbc1108a95ed67a19295036056f5))

### Unknown

*  feat(repeat): add immediately opt for repeat ([`d095573`](https://github.com/taskforcesh/bullmq/commit/d095573f8e7ce5911f777df48368382eceb99d6a))


## v1.26.5 (2021-05-21)

### Chore

* chore(release): 1.26.5 [skip ci]

## [1.26.5](https://github.com/taskforcesh/bullmq/compare/v1.26.4...v1.26.5) (2021-05-21)

### Bug Fixes

* **movetofinished:** use parent queue for events ([1b17b62](https://github.com/taskforcesh/bullmq/commit/1b17b62a794728a318f1079e73d07e33fe65c9c7)) ([`a283a2b`](https://github.com/taskforcesh/bullmq/commit/a283a2b78a325eb8e7a0531bfe50f726326741c8))

### Documentation

* docs(job): fix typo ([`afb1d5c`](https://github.com/taskforcesh/bullmq/commit/afb1d5cd203b8985be4c0482ac5595de7238f0db))

### Fix

* fix(movetofinished): use parent queue for events ([`1b17b62`](https://github.com/taskforcesh/bullmq/commit/1b17b62a794728a318f1079e73d07e33fe65c9c7))


## v1.26.4 (2021-05-20)

### Chore

* chore(release): 1.26.4 [skip ci]

## [1.26.4](https://github.com/taskforcesh/bullmq/compare/v1.26.3...v1.26.4) (2021-05-20)

### Bug Fixes

* **removejob:** delete processed hash ([a2a5058](https://github.com/taskforcesh/bullmq/commit/a2a5058f18ab77ed4d0114d48f47e6144d632cbf)) ([`c3887d6`](https://github.com/taskforcesh/bullmq/commit/c3887d6ced3035f9a8c2221bd2403427db816fb3))

### Documentation

* docs: update README ([`3a771d1`](https://github.com/taskforcesh/bullmq/commit/3a771d1547ecd34e71cad624e42872037d248d79))

### Fix

* fix(removejob): delete processed hash ([`a2a5058`](https://github.com/taskforcesh/bullmq/commit/a2a5058f18ab77ed4d0114d48f47e6144d632cbf))


## v1.26.3 (2021-05-19)

### Chore

* chore(release): 1.26.3 [skip ci]

## [1.26.3](https://github.com/taskforcesh/bullmq/compare/v1.26.2...v1.26.3) (2021-05-19)

### Bug Fixes

* ensure connection reconnects when pausing fixes [#160](https://github.com/taskforcesh/bullmq/issues/160) ([f38fee8](https://github.com/taskforcesh/bullmq/commit/f38fee84def75dd8a38cbb8bfb5aa662485ddf91)) ([`0eb67d5`](https://github.com/taskforcesh/bullmq/commit/0eb67d5b7b41ca92de35ea24b49e05870fd863b1))

### Documentation

* docs(changelog): adding missing version messages ([`41ab373`](https://github.com/taskforcesh/bullmq/commit/41ab373e8e411ec6279c3fa8468cdf3c49d578e2))

### Fix

* fix: ensure connection reconnects when pausing fixes #160 ([`f38fee8`](https://github.com/taskforcesh/bullmq/commit/f38fee84def75dd8a38cbb8bfb5aa662485ddf91))

### Style

* style(changelog): more formatting ([`35c90e8`](https://github.com/taskforcesh/bullmq/commit/35c90e84701d5412a7c76ddf406aaea1a7b674ba))

* style(changelog): formatting old messages ([`0197382`](https://github.com/taskforcesh/bullmq/commit/01973826e6213fc3a4519e2efa04b2b9f4e64c99))


## v1.26.2 (2021-05-18)

### Chore

* chore(release): 1.26.2 [skip ci]

## [1.26.2](https://github.com/taskforcesh/bullmq/compare/v1.26.1...v1.26.2) (2021-05-18)

### Bug Fixes

* **getjoblogs:** no reversed pagination ([fb0c3a5](https://github.com/taskforcesh/bullmq/commit/fb0c3a50f0d37851a8f35cb4c478259a63d93461)) ([`09bf324`](https://github.com/taskforcesh/bullmq/commit/09bf324ef30d8f6b11ff2e6cb547da467d612d74))

* chore: rename CHANGELOG ([`018f10b`](https://github.com/taskforcesh/bullmq/commit/018f10b00d229b0c7fc218a4546670ee9b47e40d))

### Fix

* fix(getjoblogs): no reversed pagination ([`fb0c3a5`](https://github.com/taskforcesh/bullmq/commit/fb0c3a50f0d37851a8f35cb4c478259a63d93461))

### Unknown

* Update SUMMARY.md ([`cba5d26`](https://github.com/taskforcesh/bullmq/commit/cba5d26dd226fc6fc0fc5cf6c121fa8ff4dfdb12))


## v1.26.1 (2021-05-17)

### Chore

* chore(release): 1.26.1 [skip ci]

## [1.26.1](https://github.com/taskforcesh/bullmq/compare/v1.26.0...v1.26.1) (2021-05-17)

### Bug Fixes

* **flow-producer:** use custom jobId as parentId for children, fixes [#552](https://github.com/taskforcesh/bullmq/issues/552) ([645b576](https://github.com/taskforcesh/bullmq/commit/645b576c1aabd8426ab77a68c199a594867cd729)) ([`a907c6e`](https://github.com/taskforcesh/bullmq/commit/a907c6e56c76b601e0f7ae3db64db7e08355d717))

### Fix

* fix(flow-producer): use custom jobId as parentId for children, fixes #552 ([`645b576`](https://github.com/taskforcesh/bullmq/commit/645b576c1aabd8426ab77a68c199a594867cd729))


## v1.26.0 (2021-05-17)

### Chore

* chore(release): 1.26.0 [skip ci]

# [1.26.0](https://github.com/taskforcesh/bullmq/compare/v1.25.2...v1.26.0) (2021-05-17)

### Features

* **custombackoff:** provide job as third parameter ([ddaf8dc](https://github.com/taskforcesh/bullmq/commit/ddaf8dc2f95ca336cb117a540edd4640d5d579e4)) ([`2656566`](https://github.com/taskforcesh/bullmq/commit/26565660b410c9c38adee13ecbe274b934d2cd64))

### Feature

* feat(custombackoff): provide job as third parameter ([`ddaf8dc`](https://github.com/taskforcesh/bullmq/commit/ddaf8dc2f95ca336cb117a540edd4640d5d579e4))


## v1.25.2 (2021-05-17)

### Chore

* chore(release): 1.25.2 [skip ci]

## [1.25.2](https://github.com/taskforcesh/bullmq/compare/v1.25.1...v1.25.2) (2021-05-17)

### Bug Fixes

* **flow-producer:** process parent with children as empty array, fixes [#547](https://github.com/taskforcesh/bullmq/issues/547) ([48168f0](https://github.com/taskforcesh/bullmq/commit/48168f07cbaed7ed522c68d127a0c7d5e4cb380e)) ([`f7601d7`](https://github.com/taskforcesh/bullmq/commit/f7601d7edb36398cf7070c927709c191cabbaebe))

* chore: fix changelog file ([`5a9d530`](https://github.com/taskforcesh/bullmq/commit/5a9d530b027bbb8d44af82b2e4f954e8a013d6da))

### Documentation

* docs: reword sentences in stalled.md ([`b679dd6`](https://github.com/taskforcesh/bullmq/commit/b679dd6904ca82432887f5ccd6636afc2ae43428))

### Fix

* fix(flow-producer): process parent with children as empty array, fixes #547 ([`48168f0`](https://github.com/taskforcesh/bullmq/commit/48168f07cbaed7ed522c68d127a0c7d5e4cb380e))

### Unknown

* remove lowercase changelog ([`daad876`](https://github.com/taskforcesh/bullmq/commit/daad876a973bc2771b000b150e939de77d24cc4e))


## v1.25.1 (2021-05-13)

### Chore

* chore(release): 1.25.1 [skip ci]

## [1.25.1](https://github.com/taskforcesh/bullmq/compare/v1.25.0...v1.25.1) (2021-05-13)

### Bug Fixes

* **addbulk:** should not consider repeat option ([c85357e](https://github.com/taskforcesh/bullmq/commit/c85357e415b9ea66f845f751a4943b5c48c2bb18)) ([`0c50dbf`](https://github.com/taskforcesh/bullmq/commit/0c50dbf958d5778293bfdde5dc2a22c60f6658c3))

### Fix

* fix(addbulk): should not consider repeat option ([`c85357e`](https://github.com/taskforcesh/bullmq/commit/c85357e415b9ea66f845f751a4943b5c48c2bb18))

### Unknown

* Update README.md ([`1b220b6`](https://github.com/taskforcesh/bullmq/commit/1b220b64b212aa9cc952795d6bb60e9454acca86))


## v1.25.0 (2021-05-11)

### Chore

* chore(release): 1.25.0 [skip ci]

# [1.25.0](https://github.com/taskforcesh/bullmq/compare/v1.24.5...v1.25.0) (2021-05-11)

### Features

* **job:** add sizeLimit option when creating a job ([f10aeeb](https://github.com/taskforcesh/bullmq/commit/f10aeeb62520d20b31d35440524d147ac4adcc9c)) ([`c687877`](https://github.com/taskforcesh/bullmq/commit/c687877156b49feb5228e472750ad8274a454630))

### Documentation

* docs: fix job type in sandbox-processors guide fixes #539 ([`81bbf4a`](https://github.com/taskforcesh/bullmq/commit/81bbf4a7b7d929936ad9c27ead7fc25fb570654a))

* docs: fix typo in flows.md ([`3d8f042`](https://github.com/taskforcesh/bullmq/commit/3d8f042f3906b38c4f1ee29e88c0414a1a5641ca))

* docs(job): add descriptions to public properties ([`86e663b`](https://github.com/taskforcesh/bullmq/commit/86e663beb23e6a5530fa69c076553996708bbfb5))

* docs(joboptions): more documentation on timestamp ([`ee9fb5b`](https://github.com/taskforcesh/bullmq/commit/ee9fb5b1f61a18e06dd7ad37e6dcbdf1d1998169))

### Feature

* feat(job): add sizeLimit option when creating a job ([`f10aeeb`](https://github.com/taskforcesh/bullmq/commit/f10aeeb62520d20b31d35440524d147ac4adcc9c))

### Unknown

* Merge branch &#39;master&#39; of https://github.com/taskforcesh/bullmq ([`a544d68`](https://github.com/taskforcesh/bullmq/commit/a544d68446d918957aa5a30a44bc6de79d162ae2))


## v1.24.5 (2021-05-08)

### Chore

* chore(release): 1.24.5 [skip ci]

## [1.24.5](https://github.com/taskforcesh/bullmq/compare/v1.24.4...v1.24.5) (2021-05-08)

### Bug Fixes

* **deps:** upgrading lodash to 4.17.21 ([6e90c3f](https://github.com/taskforcesh/bullmq/commit/6e90c3f0a3d2735875ebf44457b342629aa14572)) ([`d7f8e47`](https://github.com/taskforcesh/bullmq/commit/d7f8e4704feff803399be8a4771967fdc0dd8f3c))

* chore: apply lint ([`2b7aea5`](https://github.com/taskforcesh/bullmq/commit/2b7aea5186e3ab3fabc5e56850f5b8a5898940ff))

### Documentation

* docs(gitook): fix typo in queuescheduler.md ([`f942364`](https://github.com/taskforcesh/bullmq/commit/f94236431aba016a2dbe957bf9e01573eb2e0cdd))

### Fix

* fix(deps): upgrading lodash to 4.17.21 ([`6e90c3f`](https://github.com/taskforcesh/bullmq/commit/6e90c3f0a3d2735875ebf44457b342629aa14572))

### Unknown

* Update README.md ([`8b5cf34`](https://github.com/taskforcesh/bullmq/commit/8b5cf349fe47e72c613fe1f46ea7c5275044f240))


## v1.24.4 (2021-05-07)

### Chore

* chore(release): 1.24.4 [skip ci]

## [1.24.4](https://github.com/taskforcesh/bullmq/compare/v1.24.3...v1.24.4) (2021-05-07)

### Bug Fixes

* **cluster:** add redis cluster support ([5a7dd14](https://github.com/taskforcesh/bullmq/commit/5a7dd145bd3ae11850cac6d1b4fb9b01af0e6766))
* **redisclient:** not reference types from import ([022fc04](https://github.com/taskforcesh/bullmq/commit/022fc042a17c1754af7d74acabb7dd5c397576ab)) ([`4c55cfd`](https://github.com/taskforcesh/bullmq/commit/4c55cfdc011101ec2a9598bf470d0113949f1281))

### Fix

* fix(redisclient): not reference types from import ([`022fc04`](https://github.com/taskforcesh/bullmq/commit/022fc042a17c1754af7d74acabb7dd5c397576ab))

* fix(cluster): add redis cluster support ([`5a7dd14`](https://github.com/taskforcesh/bullmq/commit/5a7dd145bd3ae11850cac6d1b4fb9b01af0e6766))


## v1.24.3 (2021-05-05)

### Chore

* chore(release): 1.24.3 [skip ci]

## [1.24.3](https://github.com/taskforcesh/bullmq/compare/v1.24.2...v1.24.3) (2021-05-05)

### Bug Fixes

* **sandbox:** properly redirect stdout ([#525](https://github.com/taskforcesh/bullmq/issues/525)) ([c8642a0](https://github.com/taskforcesh/bullmq/commit/c8642a0724dc3d2f77abc4b5d6d24efa67c1e592)) ([`caacaee`](https://github.com/taskforcesh/bullmq/commit/caacaeef3147871f9dc1e9849dbffbfd6e8101b4))

### Fix

* fix(sandbox): properly redirect stdout (#525) ([`c8642a0`](https://github.com/taskforcesh/bullmq/commit/c8642a0724dc3d2f77abc4b5d6d24efa67c1e592))


## v1.24.2 (2021-05-05)

### Chore

* chore(release): 1.24.2 [skip ci]

## [1.24.2](https://github.com/taskforcesh/bullmq/compare/v1.24.1...v1.24.2) (2021-05-05)

### Bug Fixes

* **sandbox:** handle broken processor files ([2326983](https://github.com/taskforcesh/bullmq/commit/23269839af0be2f7cf2a4f6062563d30904bc259)) ([`6bdacb8`](https://github.com/taskforcesh/bullmq/commit/6bdacb8a37b85c0d98fdbf501b044aab97f90e28))

### Fix

* fix(sandbox): handle broken processor files ([`2326983`](https://github.com/taskforcesh/bullmq/commit/23269839af0be2f7cf2a4f6062563d30904bc259))


## v1.24.1 (2021-05-05)

### Chore

* chore(release): 1.24.1 [skip ci]

## [1.24.1](https://github.com/taskforcesh/bullmq/compare/v1.24.0...v1.24.1) (2021-05-05)

### Bug Fixes

* **queueevents:** add active type fixes [#519](https://github.com/taskforcesh/bullmq/issues/519) ([10af883](https://github.com/taskforcesh/bullmq/commit/10af883db849cf9392b26724903f88752d9be92c)) ([`7679ada`](https://github.com/taskforcesh/bullmq/commit/7679ada2038ae6c3a3bc66a0f46604e1e47e4950))

* chore: replace tslint with eslint ([`5770aef`](https://github.com/taskforcesh/bullmq/commit/5770aef2cc8fd450b619f154236b77b1a0181605))

### Fix

* fix(queueevents): add active type fixes #519 ([`10af883`](https://github.com/taskforcesh/bullmq/commit/10af883db849cf9392b26724903f88752d9be92c))


## v1.24.0 (2021-05-03)

### Chore

* chore(release): 1.24.0 [skip ci]

# [1.24.0](https://github.com/taskforcesh/bullmq/compare/v1.23.1...v1.24.0) (2021-05-03)

### Features

* add option for non-blocking getNextJob ([13ce2cf](https://github.com/taskforcesh/bullmq/commit/13ce2cfd4ccd64f45567df31de11af95b0fe67d9)) ([`b75b4f1`](https://github.com/taskforcesh/bullmq/commit/b75b4f1b0d63a83f93870c539201aae486782756))

### Feature

* feat: add option for non-blocking getNextJob ([`13ce2cf`](https://github.com/taskforcesh/bullmq/commit/13ce2cfd4ccd64f45567df31de11af95b0fe67d9))


## v1.23.1 (2021-05-03)

### Chore

* chore(release): 1.23.1 [skip ci]

## [1.23.1](https://github.com/taskforcesh/bullmq/compare/v1.23.0...v1.23.1) (2021-05-03)

### Bug Fixes

* add return type for job.waitUntilFinished() ([59ede97](https://github.com/taskforcesh/bullmq/commit/59ede976061a738503f70d9eb0c92a4b1d6ae4a3)) ([`ed35d24`](https://github.com/taskforcesh/bullmq/commit/ed35d24d1f1e8f810a0a4825c6d7e3732772d7c8))

### Fix

* fix: add return type for job.waitUntilFinished() ([`59ede97`](https://github.com/taskforcesh/bullmq/commit/59ede976061a738503f70d9eb0c92a4b1d6ae4a3))


## v1.23.0 (2021-04-30)

### Chore

* chore(release): 1.23.0 [skip ci]

# [1.23.0](https://github.com/taskforcesh/bullmq/compare/v1.22.2...v1.23.0) (2021-04-30)

### Features

* **job:** pass parent opts to addBulk ([7f21615](https://github.com/taskforcesh/bullmq/commit/7f216153293e45c4f33f2592561c925ca4464d44)) ([`3283af2`](https://github.com/taskforcesh/bullmq/commit/3283af26c1fead3c3395bf2fc82790cb0772380f))

### Feature

* feat(job): pass parent opts to addBulk ([`7f21615`](https://github.com/taskforcesh/bullmq/commit/7f216153293e45c4f33f2592561c925ca4464d44))


## v1.22.2 (2021-04-29)

### Chore

* chore(release): 1.22.2 [skip ci]

## [1.22.2](https://github.com/taskforcesh/bullmq/compare/v1.22.1...v1.22.2) (2021-04-29)

### Bug Fixes

* add missing Redis Cluster types fixes [#406](https://github.com/taskforcesh/bullmq/issues/406) ([07743ff](https://github.com/taskforcesh/bullmq/commit/07743ff310ad716802afdd5bdc6844eb5296318e)) ([`277997d`](https://github.com/taskforcesh/bullmq/commit/277997d0162761921870828e6bf0073d177dc1a4))

### Fix

* fix: add missing Redis Cluster types fixes #406 ([`07743ff`](https://github.com/taskforcesh/bullmq/commit/07743ff310ad716802afdd5bdc6844eb5296318e))


## v1.22.1 (2021-04-28)

### Chore

* chore(release): 1.22.1 [skip ci]

## [1.22.1](https://github.com/taskforcesh/bullmq/compare/v1.22.0...v1.22.1) (2021-04-28)

### Bug Fixes

* **addjob:** fix redis cluster CROSSSLOT ([a5fd1d7](https://github.com/taskforcesh/bullmq/commit/a5fd1d7a0713585d11bd862bfe2d426d5242bd3c)) ([`b34ccd1`](https://github.com/taskforcesh/bullmq/commit/b34ccd1a91f20354ec7a517c54ba4b0ea708f3d3))

* chore: barrel export of FlowJob interface ([`c13da36`](https://github.com/taskforcesh/bullmq/commit/c13da36f939f42b8e72a499c5d0b495d7fde8a14))

### Fix

* fix(addjob): fix redis cluster CROSSSLOT ([`a5fd1d7`](https://github.com/taskforcesh/bullmq/commit/a5fd1d7a0713585d11bd862bfe2d426d5242bd3c))


## v1.22.0 (2021-04-28)

### Chore

* chore(release): 1.22.0 [skip ci]

# [1.22.0](https://github.com/taskforcesh/bullmq/compare/v1.21.0...v1.22.0) (2021-04-28)

### Features

* **jobcreate:** allow passing parent in job.create ([ede3626](https://github.com/taskforcesh/bullmq/commit/ede3626b65fb5d3f4cebc55c813e9fa4b482b887)) ([`a7cb577`](https://github.com/taskforcesh/bullmq/commit/a7cb57704e4662b15a49228bbee56b346ee56d06))

* chore(deps): add chai-as-promised dev dependency ([`51457cf`](https://github.com/taskforcesh/bullmq/commit/51457cfd38ec05f32aaef7f5bac0aaf32518827a))

### Feature

* feat(jobcreate): allow passing parent in job.create ([`ede3626`](https://github.com/taskforcesh/bullmq/commit/ede3626b65fb5d3f4cebc55c813e9fa4b482b887))

### Test

* test: using rejectedWith in expect ([`c3ae5dc`](https://github.com/taskforcesh/bullmq/commit/c3ae5dc7afa43c80d3dc1017a132fd078bfaa08f))


## v1.21.0 (2021-04-26)

### Chore

* chore(release): 1.21.0 [skip ci]

# [1.21.0](https://github.com/taskforcesh/bullmq/compare/v1.20.6...v1.21.0) (2021-04-26)

### Features

* add typing for addNextRepeatableJob ([a3be937](https://github.com/taskforcesh/bullmq/commit/a3be9379e29ae3e01264e2269e8b03aa614fd42c)) ([`f4d89f0`](https://github.com/taskforcesh/bullmq/commit/f4d89f0d6b8b5461e3738a71f4554f12d68db4e9))

### Feature

* feat: add typing for addNextRepeatableJob ([`a3be937`](https://github.com/taskforcesh/bullmq/commit/a3be9379e29ae3e01264e2269e8b03aa614fd42c))


## v1.20.6 (2021-04-25)

### Chore

* chore(release): 1.20.6 [skip ci]

## [1.20.6](https://github.com/taskforcesh/bullmq/compare/v1.20.5...v1.20.6) (2021-04-25)

### Bug Fixes

* **movetocompleted:** should not complete before children ([812ff66](https://github.com/taskforcesh/bullmq/commit/812ff664b3e162dd87831ca04ebfdb783cc7ae5b)) ([`7320304`](https://github.com/taskforcesh/bullmq/commit/73203048a5ff085a5d6fe006a1173ca179b8fd5a))

### Fix

* fix(movetocompleted): should not complete before children ([`812ff66`](https://github.com/taskforcesh/bullmq/commit/812ff664b3e162dd87831ca04ebfdb783cc7ae5b))


## v1.20.5 (2021-04-23)

### Chore

* chore(release): 1.20.5 [skip ci]

## [1.20.5](https://github.com/taskforcesh/bullmq/compare/v1.20.4...v1.20.5) (2021-04-23)

### Bug Fixes

* **obliterate:** correctly remove many jobs ([b5ae4ce](https://github.com/taskforcesh/bullmq/commit/b5ae4ce92aeaf000408ffbbcd22d829cee20f2f8)) ([`dacd0c6`](https://github.com/taskforcesh/bullmq/commit/dacd0c66efdba779875239fcab3d18dd6a45e052))

### Fix

* fix(obliterate): correctly remove many jobs ([`b5ae4ce`](https://github.com/taskforcesh/bullmq/commit/b5ae4ce92aeaf000408ffbbcd22d829cee20f2f8))


## v1.20.4 (2021-04-23)

### Chore

* chore(release): 1.20.4 [skip ci]

## [1.20.4](https://github.com/taskforcesh/bullmq/compare/v1.20.3...v1.20.4) (2021-04-23)

### Bug Fixes

* remove internal deps on barrel fixes [#469](https://github.com/taskforcesh/bullmq/issues/469) ([#495](https://github.com/taskforcesh/bullmq/issues/495)) ([60dbeed](https://github.com/taskforcesh/bullmq/commit/60dbeed7ff1d9b6cb0e35590713fee8a7be09477)) ([`9cf71f6`](https://github.com/taskforcesh/bullmq/commit/9cf71f66b965a7cd4d92faf239a0750065b53e1d))

### Fix

* fix: remove internal deps on barrel fixes #469 (#495) ([`60dbeed`](https://github.com/taskforcesh/bullmq/commit/60dbeed7ff1d9b6cb0e35590713fee8a7be09477))


## v1.20.3 (2021-04-23)

### Chore

* chore(release): 1.20.3 [skip ci]

## [1.20.3](https://github.com/taskforcesh/bullmq/compare/v1.20.2...v1.20.3) (2021-04-23)

### Bug Fixes

* **flows:** correct typings fixes [#492](https://github.com/taskforcesh/bullmq/issues/492) ([a77f80b](https://github.com/taskforcesh/bullmq/commit/a77f80bc07e7627f512323f0dcc9141fe408809e)) ([`3b7c038`](https://github.com/taskforcesh/bullmq/commit/3b7c038a7db24f63b48cbd1d231a6740fef4ea70))

### Fix

* fix(flows): correct typings fixes #492 ([`a77f80b`](https://github.com/taskforcesh/bullmq/commit/a77f80bc07e7627f512323f0dcc9141fe408809e))


## v1.20.2 (2021-04-22)

### Chore

* chore(release): 1.20.2 [skip ci]

## [1.20.2](https://github.com/taskforcesh/bullmq/compare/v1.20.1...v1.20.2) (2021-04-22)

### Bug Fixes

* **movetodelayed:** check if job is in active state ([4e63f70](https://github.com/taskforcesh/bullmq/commit/4e63f70aac367d4dd695bbe07c72a08a82a65d97)) ([`582ae51`](https://github.com/taskforcesh/bullmq/commit/582ae517b979d9d07a9c7937c6ff6d3f449c74e9))

### Fix

* fix(movetodelayed): check if job is in active state ([`4e63f70`](https://github.com/taskforcesh/bullmq/commit/4e63f70aac367d4dd695bbe07c72a08a82a65d97))


## v1.20.1 (2021-04-22)

### Chore

* chore(release): 1.20.1 [skip ci]

## [1.20.1](https://github.com/taskforcesh/bullmq/compare/v1.20.0...v1.20.1) (2021-04-22)

### Bug Fixes

* **worker:** make token optional in processor function fixes [#490](https://github.com/taskforcesh/bullmq/issues/490) ([3940bd7](https://github.com/taskforcesh/bullmq/commit/3940bd71c6faf3bd5fce572b9c1f11cb5b5d2123)) ([`77cc94b`](https://github.com/taskforcesh/bullmq/commit/77cc94b528f1efb35639eef4a2960c8703f9120b))

* chore(npm): just publish dist files (#486) ([`1b06de3`](https://github.com/taskforcesh/bullmq/commit/1b06de395d36a86a9d8e4227e822eb014dafad2c))

### Fix

* fix(worker): make token optional in processor function fixes #490 ([`3940bd7`](https://github.com/taskforcesh/bullmq/commit/3940bd71c6faf3bd5fce572b9c1f11cb5b5d2123))


## v1.20.0 (2021-04-21)

### Chore

* chore(release): 1.20.0 [skip ci]

# [1.20.0](https://github.com/taskforcesh/bullmq/compare/v1.19.3...v1.20.0) (2021-04-21)

### Features

* **worker:** passing token in processor function ([2249724](https://github.com/taskforcesh/bullmq/commit/2249724b1bc6fbf40b0291400011f201fd02dab3)) ([`c96032a`](https://github.com/taskforcesh/bullmq/commit/c96032a425a155a8a94c9532d61c70617e4a62d5))

### Feature

* feat(worker): passing token in processor function ([`2249724`](https://github.com/taskforcesh/bullmq/commit/2249724b1bc6fbf40b0291400011f201fd02dab3))


## v1.19.3 (2021-04-20)

### Chore

* chore(release): 1.19.3 [skip ci]

## [1.19.3](https://github.com/taskforcesh/bullmq/compare/v1.19.2...v1.19.3) (2021-04-20)

### Bug Fixes

* **movetocompleted:** throw an error if job is not in active state ([c2fe5d2](https://github.com/taskforcesh/bullmq/commit/c2fe5d292fcf8ac2e53906c30282df69d43321b1)) ([`0faf083`](https://github.com/taskforcesh/bullmq/commit/0faf08379d6604973686ea1e3643a9603661823c))

### Fix

* fix(movetocompleted): throw an error if job is not in active state ([`c2fe5d2`](https://github.com/taskforcesh/bullmq/commit/c2fe5d292fcf8ac2e53906c30282df69d43321b1))

### Unknown

* GitBook: [master] one page modified ([`4f6e8c9`](https://github.com/taskforcesh/bullmq/commit/4f6e8c9ed6127a420f5d9fa817d243d0912038e6))


## v1.19.2 (2021-04-19)

### Chore

* chore(release): 1.19.2 [skip ci]

## [1.19.2](https://github.com/taskforcesh/bullmq/compare/v1.19.1...v1.19.2) (2021-04-19)

### Bug Fixes

* **worker:** close base class connection [#451](https://github.com/taskforcesh/bullmq/issues/451) ([0875306](https://github.com/taskforcesh/bullmq/commit/0875306ae801a7cbfe04758dc2481cb86ca2ef69)) ([`7521543`](https://github.com/taskforcesh/bullmq/commit/75215430ab1eb1ac11d447621e42579e026a26b5))

### Fix

* fix(worker): close base class connection #451 ([`0875306`](https://github.com/taskforcesh/bullmq/commit/0875306ae801a7cbfe04758dc2481cb86ca2ef69))


## v1.19.1 (2021-04-19)

### Chore

* chore(release): 1.19.1 [skip ci]

## [1.19.1](https://github.com/taskforcesh/bullmq/compare/v1.19.0...v1.19.1) (2021-04-19)

### Bug Fixes

* remove repeatable with obliterate ([1c5e581](https://github.com/taskforcesh/bullmq/commit/1c5e581a619ba707863c2a6e9f3e5f6eadfbe64f)) ([`8bccbc3`](https://github.com/taskforcesh/bullmq/commit/8bccbc39412da0c6ff9a2279df7031a3b40763f8))

* chore(deps): bump ssri from 6.0.1 to 6.0.2

Bumps [ssri](https://github.com/npm/ssri) from 6.0.1 to 6.0.2.
- [Release notes](https://github.com/npm/ssri/releases)
- [Changelog](https://github.com/npm/ssri/blob/v6.0.2/CHANGELOG.md)
- [Commits](https://github.com/npm/ssri/compare/v6.0.1...v6.0.2)

Signed-off-by: dependabot[bot] &lt;support@github.com&gt; ([`14b2d5e`](https://github.com/taskforcesh/bullmq/commit/14b2d5e2a882f38158b5037eae8ab0e55494bcdb))

### Fix

* fix: remove repeatable with obliterate ([`1c5e581`](https://github.com/taskforcesh/bullmq/commit/1c5e581a619ba707863c2a6e9f3e5f6eadfbe64f))


## v1.19.0 (2021-04-19)

### Chore

* chore(release): 1.19.0 [skip ci]

# [1.19.0](https://github.com/taskforcesh/bullmq/compare/v1.18.2...v1.19.0) (2021-04-19)

### Features

* add workerDelay option to limiter ([9b6ab8a](https://github.com/taskforcesh/bullmq/commit/9b6ab8ad4bc0a94068f3bc707ad9c0ed01596068)) ([`cee7a02`](https://github.com/taskforcesh/bullmq/commit/cee7a02d8b08fea11bdff26c896fd2afcc82468d))

### Feature

* feat: add workerDelay option to limiter ([`9b6ab8a`](https://github.com/taskforcesh/bullmq/commit/9b6ab8ad4bc0a94068f3bc707ad9c0ed01596068))

### Unknown

* GitBook: [master] 39 pages modified ([`3becac3`](https://github.com/taskforcesh/bullmq/commit/3becac377a13eaa0c66d8f8547a206763b1605cf))


## v1.18.2 (2021-04-16)

### Chore

* chore(release): 1.18.2 [skip ci]

## [1.18.2](https://github.com/taskforcesh/bullmq/compare/v1.18.1...v1.18.2) (2021-04-16)

### Bug Fixes

* add parentKey property to Job ([febc60d](https://github.com/taskforcesh/bullmq/commit/febc60dba94c29b85be3e1bc2547fa83ed932806)) ([`bc66de0`](https://github.com/taskforcesh/bullmq/commit/bc66de0678ccf93ff8add2e20e4b70870e7b641a))

### Fix

* fix: add parentKey property to Job ([`febc60d`](https://github.com/taskforcesh/bullmq/commit/febc60dba94c29b85be3e1bc2547fa83ed932806))

### Unknown

* GitBook: [master] one page modified ([`b0d33c5`](https://github.com/taskforcesh/bullmq/commit/b0d33c51e80dd3706596af57f553b4086bcdee6d))

* GitBook: [master] 40 pages modified ([`498073d`](https://github.com/taskforcesh/bullmq/commit/498073dabb106153d374f41fdac2f10d3dd9fd21))

* GitBook: [master] 2 pages modified ([`d27e3eb`](https://github.com/taskforcesh/bullmq/commit/d27e3ebf120dae16f74a02bec833b50d01477a16))


## v1.18.1 (2021-04-16)

### Chore

* chore(release): 1.18.1 [skip ci]

## [1.18.1](https://github.com/taskforcesh/bullmq/compare/v1.18.0...v1.18.1) (2021-04-16)

### Bug Fixes

* rename Flow to FlowProducer class ([c64321d](https://github.com/taskforcesh/bullmq/commit/c64321d03e2af7cee88eaf6df6cd2e5b7840ae64)) ([`b43431c`](https://github.com/taskforcesh/bullmq/commit/b43431c47defe0b9a68d64fab8c9e09c953281c3))

### Fix

* fix: rename Flow to FlowProducer class ([`c64321d`](https://github.com/taskforcesh/bullmq/commit/c64321d03e2af7cee88eaf6df6cd2e5b7840ae64))


## v1.18.0 (2021-04-16)

### Chore

* chore(release): 1.18.0 [skip ci]

# [1.18.0](https://github.com/taskforcesh/bullmq/compare/v1.17.0...v1.18.0) (2021-04-16)

### Features

* add remove support for flows ([4e8a7ef](https://github.com/taskforcesh/bullmq/commit/4e8a7efd53f918937478ae13f5da7dee9ea9d8b3)) ([`301e0fb`](https://github.com/taskforcesh/bullmq/commit/301e0fb9acc1c21ae129bc7e574ad88a4c53b577))

### Feature

* feat: add remove support for flows ([`4e8a7ef`](https://github.com/taskforcesh/bullmq/commit/4e8a7efd53f918937478ae13f5da7dee9ea9d8b3))


## v1.17.0 (2021-04-16)

### Chore

* chore(release): 1.17.0 [skip ci]

# [1.17.0](https://github.com/taskforcesh/bullmq/compare/v1.16.2...v1.17.0) (2021-04-16)

### Features

* **job:** consider waiting-children state ([2916dd5](https://github.com/taskforcesh/bullmq/commit/2916dd5d7ba9438d2eae66436899d32ec8ac0e91)) ([`dcb5f5b`](https://github.com/taskforcesh/bullmq/commit/dcb5f5b12b133a60b4ed09cc083915187c84ed2d))

### Feature

* feat(job): consider waiting-children state ([`2916dd5`](https://github.com/taskforcesh/bullmq/commit/2916dd5d7ba9438d2eae66436899d32ec8ac0e91))

### Style

* style: fixing comments ([`9d5767b`](https://github.com/taskforcesh/bullmq/commit/9d5767b649b4049e276439549d3ab07d7fa7dc4b))


## v1.16.2 (2021-04-14)

### Chore

* chore(release): 1.16.2 [skip ci]

## [1.16.2](https://github.com/taskforcesh/bullmq/compare/v1.16.1...v1.16.2) (2021-04-14)

### Bug Fixes

* read lua scripts serially ([69e73b8](https://github.com/taskforcesh/bullmq/commit/69e73b87bc6855623240a7b1a45368a7914b23b7)) ([`ca5db26`](https://github.com/taskforcesh/bullmq/commit/ca5db266d7f2407e16c5edb8d068d5d374a902f8))

### Fix

* fix: read lua scripts serially ([`69e73b8`](https://github.com/taskforcesh/bullmq/commit/69e73b87bc6855623240a7b1a45368a7914b23b7))


## v1.16.1 (2021-04-12)

### Chore

* chore(release): 1.16.1 [skip ci]

## [1.16.1](https://github.com/taskforcesh/bullmq/compare/v1.16.0...v1.16.1) (2021-04-12)

### Bug Fixes

* **flow:** relative dependency path fixes [#466](https://github.com/taskforcesh/bullmq/issues/466) ([d104bf8](https://github.com/taskforcesh/bullmq/commit/d104bf802d6d1000ac1ccd781fa7a07bce2fe140)) ([`c1b5211`](https://github.com/taskforcesh/bullmq/commit/c1b5211fc6455c2b256094b87bffa3f84ff03c12))

### Fix

* fix(flow): relative dependency path fixes #466 ([`d104bf8`](https://github.com/taskforcesh/bullmq/commit/d104bf802d6d1000ac1ccd781fa7a07bce2fe140))

### Unknown

* GitBook: [master] 39 pages modified ([`59bc9ad`](https://github.com/taskforcesh/bullmq/commit/59bc9ad4216cebb4d8cc670da3f745e83acc4ac1))


## v1.16.0 (2021-04-12)

### Chore

* chore(release): 1.16.0 [skip ci]

# [1.16.0](https://github.com/taskforcesh/bullmq/compare/v1.15.1...v1.16.0) (2021-04-12)

### Features

* add support for flows (parent-child dependencies) ([#454](https://github.com/taskforcesh/bullmq/issues/454)) ([362212c](https://github.com/taskforcesh/bullmq/commit/362212c58c4be36b5435df862503699deb8bb79c)) ([`d1254fa`](https://github.com/taskforcesh/bullmq/commit/d1254fadc1060260f82490de9aa4d874d6ddcd52))

* chore: add proper return type to getChildrenValues ([`331462c`](https://github.com/taskforcesh/bullmq/commit/331462c96313ecb79618258c0aa2416a6f22e953))

* chore(deps): upgrade ioredis to 4.25.0 ([`bc533ca`](https://github.com/taskforcesh/bullmq/commit/bc533ca119600f92caca020dd280c1011e849417))

### Documentation

* docs: fix typo ([`baa90b2`](https://github.com/taskforcesh/bullmq/commit/baa90b2090bcc7d86ed3dedd4d9d6202af6c8606))

* docs: update README.md ([`927cc0c`](https://github.com/taskforcesh/bullmq/commit/927cc0c1abc647ad105ac56f5443ec3c675f04d5))

### Feature

* feat: add support for flows (parent-child dependencies) (#454) ([`362212c`](https://github.com/taskforcesh/bullmq/commit/362212c58c4be36b5435df862503699deb8bb79c))

### Refactor

* refactor(getstate): adding getState script ([`a044124`](https://github.com/taskforcesh/bullmq/commit/a044124a88c23ab43746026486eac41432d37ff7))

### Unknown

* GitBook: [master] one page modified ([`5c6e5d2`](https://github.com/taskforcesh/bullmq/commit/5c6e5d230df52bd9055ebecf5f5cb4f65764a15d))

* GitBook: [master] 3 pages modified ([`1450fea`](https://github.com/taskforcesh/bullmq/commit/1450feab58e0ab13737e465dbb5d8bcabf52b5d4))

* GitBook: [master] 3 pages modified ([`2a903c2`](https://github.com/taskforcesh/bullmq/commit/2a903c2f0c1100dd64b3b0852fea8b171da329ec))

* GitBook: [master] one page modified ([`e2b6479`](https://github.com/taskforcesh/bullmq/commit/e2b64792e84b1983d5bdeab8e630c02a9275cca1))

* GitBook: [master] one page modified ([`c2cfc96`](https://github.com/taskforcesh/bullmq/commit/c2cfc965a05d1f2292e81b3819426059a7d5795f))


## v1.15.1 (2021-03-19)

### Chore

* chore(release): 1.15.1 [skip ci]

## [1.15.1](https://github.com/taskforcesh/bullmq/compare/v1.15.0...v1.15.1) (2021-03-19)

### Bug Fixes

* **obliterate:** safer implementation ([82f571f](https://github.com/taskforcesh/bullmq/commit/82f571f2548c61c776b897fd1c5050bb09c8afca)) ([`0e0540e`](https://github.com/taskforcesh/bullmq/commit/0e0540e311abcc366f377f70abf68ede78a279ba))

### Fix

* fix(obliterate): safer implementation ([`82f571f`](https://github.com/taskforcesh/bullmq/commit/82f571f2548c61c776b897fd1c5050bb09c8afca))


## v1.15.0 (2021-03-18)

### Chore

* chore(release): 1.15.0 [skip ci]

# [1.15.0](https://github.com/taskforcesh/bullmq/compare/v1.14.8...v1.15.0) (2021-03-18)

### Features

* add method to &#34;obliterate&#34; a queue, fixes [#430](https://github.com/taskforcesh/bullmq/issues/430) ([624be0e](https://github.com/taskforcesh/bullmq/commit/624be0ed48159c2aa405025938925a723330e0c2)) ([`61d39d5`](https://github.com/taskforcesh/bullmq/commit/61d39d55967037378710c811a2cbb837950e220c))

### Feature

* feat: add method to &#34;obliterate&#34; a queue, fixes #430 ([`624be0e`](https://github.com/taskforcesh/bullmq/commit/624be0ed48159c2aa405025938925a723330e0c2))

### Unknown

* GitBook: [master] 38 pages modified ([`300cedc`](https://github.com/taskforcesh/bullmq/commit/300cedcde02c44acda8dbbd5777d89ca9cfba2e5))

* GitBook: [master] one page modified ([`28dea5f`](https://github.com/taskforcesh/bullmq/commit/28dea5f465fbfdea57f1767791836e0ebf82e104))

* GitBook: [master] 36 pages and one asset modified ([`321d4a0`](https://github.com/taskforcesh/bullmq/commit/321d4a03929bc1433e99d00f7f1c0a961aa20ca6))


## v1.14.8 (2021-03-06)

### Chore

* chore(release): 1.14.8 [skip ci]

## [1.14.8](https://github.com/taskforcesh/bullmq/compare/v1.14.7...v1.14.8) (2021-03-06)

### Bug Fixes

* specify promise type to make TS 4.1 and 4.2 happy. ([#418](https://github.com/taskforcesh/bullmq/issues/418)) ([702f609](https://github.com/taskforcesh/bullmq/commit/702f609b410d8b0652c2d0504a8a67526966fdc3)) ([`cd4d02b`](https://github.com/taskforcesh/bullmq/commit/cd4d02bd8b44366ac3060ebbd00bafcf1c2cea3a))

### Fix

* fix: specify promise type to make TS 4.1 and 4.2 happy. (#418) ([`702f609`](https://github.com/taskforcesh/bullmq/commit/702f609b410d8b0652c2d0504a8a67526966fdc3))

### Unknown

* Update README.md ([`c0fb48e`](https://github.com/taskforcesh/bullmq/commit/c0fb48ecc127088006463b806772688be83cd405))

* Update README.md ([`ac29d08`](https://github.com/taskforcesh/bullmq/commit/ac29d0857a4e31d93ae1782aa3e0838cf125d4ce))

* GitBook: [master] one page modified ([`742fe5b`](https://github.com/taskforcesh/bullmq/commit/742fe5bb42e1223d70e0d5046c5d21ef52c026bb))

* GitBook: [master] one page modified ([`2ace43d`](https://github.com/taskforcesh/bullmq/commit/2ace43dc0e6103592188d64ac4eda0a8597c3103))


## v1.14.7 (2021-02-16)

### Chore

* chore(release): 1.14.7 [skip ci]

## [1.14.7](https://github.com/taskforcesh/bullmq/compare/v1.14.6...v1.14.7) (2021-02-16)

### Bug Fixes

* remove &#34;client&#34; property of QueueBaseOptions ([#324](https://github.com/taskforcesh/bullmq/issues/324)) ([e0b9e71](https://github.com/taskforcesh/bullmq/commit/e0b9e71c4da4a93af54c4386af461c61ab5f146c)) ([`9d0f6e7`](https://github.com/taskforcesh/bullmq/commit/9d0f6e76dfc4f918e039986d9666d5ed485f4904))

### Fix

* fix: remove &#34;client&#34; property of QueueBaseOptions (#324) ([`e0b9e71`](https://github.com/taskforcesh/bullmq/commit/e0b9e71c4da4a93af54c4386af461c61ab5f146c))


## v1.14.6 (2021-02-16)

### Chore

* chore(release): 1.14.6 [skip ci]

## [1.14.6](https://github.com/taskforcesh/bullmq/compare/v1.14.5...v1.14.6) (2021-02-16)

### Bug Fixes

* remove next job in removeRepeatableByKey fixes [#165](https://github.com/taskforcesh/bullmq/issues/165) ([fb3a7c2](https://github.com/taskforcesh/bullmq/commit/fb3a7c2f429d535dd9f038687d7230d61201defc)) ([`5e6631e`](https://github.com/taskforcesh/bullmq/commit/5e6631e7c3f40b7857d2f73b48abfd3f9d072b35))

### Fix

* fix: remove next job in removeRepeatableByKey fixes #165 ([`fb3a7c2`](https://github.com/taskforcesh/bullmq/commit/fb3a7c2f429d535dd9f038687d7230d61201defc))

### Unknown

* GitBook: [master] one page modified ([`6e61c56`](https://github.com/taskforcesh/bullmq/commit/6e61c5629af24ac9b374786eab4580e6cb3ea2cb))

* GitBook: [master] 34 pages modified ([`a006bc0`](https://github.com/taskforcesh/bullmq/commit/a006bc028e9178c0cccf335e9fd25db87120f326))


## v1.14.5 (2021-02-16)

### Chore

* chore(release): 1.14.5 [skip ci]

## [1.14.5](https://github.com/taskforcesh/bullmq/compare/v1.14.4...v1.14.5) (2021-02-16)

### Bug Fixes

* add jobId support to repeatable jobs fixes [#396](https://github.com/taskforcesh/bullmq/issues/396) ([c2dc669](https://github.com/taskforcesh/bullmq/commit/c2dc6693a4546e547245bc7ec1e71b4841829619)) ([`c5e3a2a`](https://github.com/taskforcesh/bullmq/commit/c5e3a2a73e0714649a3d975d15a45cbcb255db45))

### Documentation

* docs: fix typo (#395) ([`e5a29bf`](https://github.com/taskforcesh/bullmq/commit/e5a29bf17dad2d9f75fbeb0db33353ddf49f1643))

### Fix

* fix: add jobId support to repeatable jobs fixes #396 ([`c2dc669`](https://github.com/taskforcesh/bullmq/commit/c2dc6693a4546e547245bc7ec1e71b4841829619))


## v1.14.4 (2021-02-08)

### Chore

* chore(release): 1.14.4 [skip ci]

## [1.14.4](https://github.com/taskforcesh/bullmq/compare/v1.14.3...v1.14.4) (2021-02-08)

### Bug Fixes

* reconnect at start fixes [#337](https://github.com/taskforcesh/bullmq/issues/337) ([fb33772](https://github.com/taskforcesh/bullmq/commit/fb3377280b3bda04a15a62d2901bdd78b869e08c)) ([`e0f56b3`](https://github.com/taskforcesh/bullmq/commit/e0f56b3ce656cf5b609996905b14caf4d1fcb3ab))

### Fix

* fix: reconnect at start fixes #337 ([`fb33772`](https://github.com/taskforcesh/bullmq/commit/fb3377280b3bda04a15a62d2901bdd78b869e08c))

### Test

* test: skip test for invalid connection ([`19dfd78`](https://github.com/taskforcesh/bullmq/commit/19dfd78ecf034df06032bbf6b805d8114ac7c182))


## v1.14.3 (2021-02-07)

### Chore

* chore(release): 1.14.3 [skip ci]

## [1.14.3](https://github.com/taskforcesh/bullmq/compare/v1.14.2...v1.14.3) (2021-02-07)

### Bug Fixes

* **worker:** avoid possible infinite loop fixes [#389](https://github.com/taskforcesh/bullmq/issues/389) ([d05566e](https://github.com/taskforcesh/bullmq/commit/d05566ec0153f31a1257f7338399fdb55c959487)) ([`8266fcc`](https://github.com/taskforcesh/bullmq/commit/8266fccc4bbac63a2a0509e4df749a2b07fc72d9))

### Fix

* fix(worker): avoid possible infinite loop fixes #389 ([`d05566e`](https://github.com/taskforcesh/bullmq/commit/d05566ec0153f31a1257f7338399fdb55c959487))


## v1.14.2 (2021-02-02)

### Chore

* chore(release): 1.14.2 [skip ci]

## [1.14.2](https://github.com/taskforcesh/bullmq/compare/v1.14.1...v1.14.2) (2021-02-02)

### Bug Fixes

* improve job timeout notification by giving the job name and id in the error message ([#387](https://github.com/taskforcesh/bullmq/issues/387)) ([ca886b1](https://github.com/taskforcesh/bullmq/commit/ca886b1f854051aed0888f5b872a64b052b2383e)) ([`c76d3f9`](https://github.com/taskforcesh/bullmq/commit/c76d3f9547fc88c286b171982ff07ce4e6c0ff33))

### Fix

* fix: improve job timeout notification by giving the job name and id in the error message (#387) ([`ca886b1`](https://github.com/taskforcesh/bullmq/commit/ca886b1f854051aed0888f5b872a64b052b2383e))


## v1.14.1 (2021-02-01)

### Chore

* chore(release): 1.14.1 [skip ci]

## [1.14.1](https://github.com/taskforcesh/bullmq/compare/v1.14.0...v1.14.1) (2021-02-01)

### Bug Fixes

* job finish queue events race condition ([355bca5](https://github.com/taskforcesh/bullmq/commit/355bca5ee128bf4ff37608746f9c6f7cca580eb0)) ([`a14e1ad`](https://github.com/taskforcesh/bullmq/commit/a14e1ada63c884d2a7a4e4f8539ef68230f83bea))

* chore(redis-connection): add explicit promise type

Silences a typescript warning when viewing the file. ([`12441ca`](https://github.com/taskforcesh/bullmq/commit/12441caee941226a6b60b8a8763a7b7edd7d6cc3))

* chore: fix api generation step ([`4664a02`](https://github.com/taskforcesh/bullmq/commit/4664a02f952ae235e21f6ea9794c3d55b337e7c5))

### Documentation

* docs: add doc for debounce usecase (#335) ([`067e32a`](https://github.com/taskforcesh/bullmq/commit/067e32aff24955b6d5bfe9c4196820f60fe21888))

* docs(timer-manager): describe setTimer() args ([`25e8cd7`](https://github.com/taskforcesh/bullmq/commit/25e8cd7ce1e444c7e7e0061ad0307e40f4156fe1))

* docs(interfaces): use block comments; add references and descriptions

- Block comments for IDE support / &#34;intellisense&#34;
- Add links to the docs for further reading
- For links, I used the format described at https://tsdoc.org/pages/tags/see/ ([`87297b8`](https://github.com/taskforcesh/bullmq/commit/87297b8b0aef281636e174b6e925eedb440df841))

* docs(queue-scheduler): fix typo ([`c63fec0`](https://github.com/taskforcesh/bullmq/commit/c63fec00c91b3811757a9a5fe4f295e6e4057f93))

* docs: add idempotence pattern ([`c28520a`](https://github.com/taskforcesh/bullmq/commit/c28520aee6600e0273adf85e64b0b9e8757e2c2a))

### Fix

* fix: job finish queue events race condition ([`355bca5`](https://github.com/taskforcesh/bullmq/commit/355bca5ee128bf4ff37608746f9c6f7cca580eb0))

### Refactor

* refactor(timer-manager): use Map to store timers

Typed map of timers instead of a plain object and type &#34;any&#34;. ([`fb9e959`](https://github.com/taskforcesh/bullmq/commit/fb9e959cc789a708a0c9ccd6036c57a3ff33311a))

### Unknown

* GitBook: [master] 5 pages modified ([`78a16a1`](https://github.com/taskforcesh/bullmq/commit/78a16a19de9264d7a5bef2c8d39a0976cbeabc18))

* GitBook: [master] 3 pages modified ([`6c10db5`](https://github.com/taskforcesh/bullmq/commit/6c10db5e2751162f39820864bae89d299d1c2d2c))

* GitBook: [master] 3 pages modified ([`ac4c9f6`](https://github.com/taskforcesh/bullmq/commit/ac4c9f62a0c4ef28ea06543c84bbefa156a9e210))

* GitBook: [master] one page modified ([`3efbff6`](https://github.com/taskforcesh/bullmq/commit/3efbff69b425969177cb08e004757ff0ff027bdb))

* GitBook: [master] one page modified ([`87db39c`](https://github.com/taskforcesh/bullmq/commit/87db39cb6f90d70e8fef05311b0698de06dfd3ff))

* GitBook: [master] one page modified ([`c166e17`](https://github.com/taskforcesh/bullmq/commit/c166e17017fa1d60ca246054a31a401633964128))

* GitBook: [master] 7 pages modified ([`ae82cd7`](https://github.com/taskforcesh/bullmq/commit/ae82cd7defcd1501a8a9e0095bf32f02e747b87b))


## v1.14.0 (2021-01-06)

### Chore

* chore(release): 1.14.0 [skip ci]

# [1.14.0](https://github.com/taskforcesh/bullmq/compare/v1.13.0...v1.14.0) (2021-01-06)

### Features

* **job:** expose extendLock as a public method ([17e8431](https://github.com/taskforcesh/bullmq/commit/17e8431af8bba58612bf9913c63ab5d38afecbb9))

yarn run v1.22.5
$ (api-extractor run || true) &amp;&amp; api-documenter markdown -i ./temp -o docs/gitbook/api

api-extractor 7.12.1  - https://api-extractor.com/

Using configuration from ./config/api-extractor.json
Analysis will use the bundled TypeScript version 4.0.5

API Extractor completed with warnings

api-documenter 7.12.1  - https://api-extractor.com/

Reading bullmq.api.json

Deleting old output from docs/gitbook/api
Writing bullmq package
Done in 5.00s. ([`8a2a748`](https://github.com/taskforcesh/bullmq/commit/8a2a748a86ca799fcd72d4b00fc9a10048e46d4c))

* chore: sanitize changelog ([`fa3ea5b`](https://github.com/taskforcesh/bullmq/commit/fa3ea5bffbf4ea3d2a4a91810842e5949a84b3ec))

* chore(release): 1.13.0 [skip ci]

# [1.13.0](https://github.com/taskforcesh/bullmq/compare/v1.12.3...v1.13.0) (2021-01-06)

### Features

* **job:** expose extendLock as a public method ([17e8431](https://github.com/taskforcesh/bullmq/commit/17e8431af8bba58612bf9913c63ab5d38afecbb9))
* add support for manually processing jobs fixes [#327](https://github.com/taskforcesh/bullmq/issues/327) ([e42bfd2](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01))

yarn run v1.22.5
$ (api-extractor run || true) &amp;&amp; api-documenter markdown -i ./temp -o docs/gitbook/api

api-extractor 7.12.1  - https://api-extractor.com/

Using configuration from ./config/api-extractor.json
Analysis will use the bundled TypeScript version 4.0.5

API Extractor completed with warnings

api-documenter 7.12.1  - https://api-extractor.com/

Reading bullmq.api.json

Deleting old output from docs/gitbook/api
Writing bullmq package
Done in 4.76s. ([`a75f4d5`](https://github.com/taskforcesh/bullmq/commit/a75f4d5fc1fa30ea0d537f0a07fbbbbd6f838275))

* chore(release): 1.13.0 [skip ci]

# [1.13.0](https://github.com/taskforcesh/bullmq/compare/v1.12.3...v1.13.0) (2021-01-06)

### Features

* add support for manually processing jobs fixes [#327](https://github.com/taskforcesh/bullmq/issues/327) ([e42bfd2](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01))

yarn run v1.22.5
$ (api-extractor run || true) &amp;&amp; api-documenter markdown -i ./temp -o docs/gitbook/api

api-extractor 7.12.1  - https://api-extractor.com/

Using configuration from ./config/api-extractor.json
Analysis will use the bundled TypeScript version 4.0.5

API Extractor completed with warnings

api-documenter 7.12.1  - https://api-extractor.com/

Reading bullmq.api.json

Deleting old output from docs/gitbook/api
Writing bullmq package
Done in 5.09s. ([`6e9a359`](https://github.com/taskforcesh/bullmq/commit/6e9a359a729a7deefa0a7a9a636ae9b8bd2dcf8e))

* chore: delete changelog.md ([`79bb38f`](https://github.com/taskforcesh/bullmq/commit/79bb38f8d39504672d1ff103d69595da1f2df473))

* chore(release): 1.13.0 [skip ci]

# [1.13.0](https://github.com/taskforcesh/bullmq/compare/v1.12.3...v1.13.0) (2021-01-06)

### Features

* add support for manually processing jobs fixes [#327](https://github.com/taskforcesh/bullmq/issues/327) ([e42bfd2](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01))

yarn run v1.22.5
$ (api-extractor run || true) &amp;&amp; api-documenter markdown -i ./temp -o docs/gitbook/api

api-extractor 7.12.1  - https://api-extractor.com/

Using configuration from ./config/api-extractor.json
Analysis will use the bundled TypeScript version 4.0.5

API Extractor completed with warnings

api-documenter 7.12.1  - https://api-extractor.com/

Reading bullmq.api.json

Deleting old output from docs/gitbook/api
Writing bullmq package
Done in 4.75s. ([`8504d5b`](https://github.com/taskforcesh/bullmq/commit/8504d5b9d76bac9f3962e2362df32591b366fdcf))

* chore(release): 1.13.0 [skip ci]

# [1.13.0](https://github.com/taskforcesh/bullmq/compare/v1.12.3...v1.13.0) (2021-01-06)

### Features

* add support for manually processing jobs fixes [#327](https://github.com/taskforcesh/bullmq/issues/327) ([e42bfd2](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01))

yarn run v1.22.5
$ (api-extractor run || true) &amp;&amp; api-documenter markdown -i ./temp -o docs/gitbook/api

api-extractor 7.12.1  - https://api-extractor.com/

Using configuration from ./config/api-extractor.json
Analysis will use the bundled TypeScript version 4.0.5

API Extractor completed with warnings

api-documenter 7.12.1  - https://api-extractor.com/

Reading bullmq.api.json

Deleting old output from docs/gitbook/api
Writing bullmq package
Done in 5.06s. ([`1d83485`](https://github.com/taskforcesh/bullmq/commit/1d83485e284033d702ef3364e5436880966fb95a))

* chore(release): 1.13.0 [skip ci]

# [1.13.0](https://github.com/taskforcesh/bullmq/compare/v1.12.3...v1.13.0) (2020-12-30)

### Features

* add support for manually processing jobs fixes [#327](https://github.com/taskforcesh/bullmq/issues/327) ([e42bfd2](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01))

yarn run v1.22.5
$ (api-extractor run || true) &amp;&amp; api-documenter markdown -i ./temp -o docs/gitbook/api

api-extractor 7.12.1  - https://api-extractor.com/

Using configuration from ./config/api-extractor.json
Analysis will use the bundled TypeScript version 4.0.5

API Extractor completed with warnings

api-documenter 7.12.1  - https://api-extractor.com/

Reading bullmq.api.json

Deleting old output from docs/gitbook/api
Writing bullmq package
Done in 4.57s. ([`57b37ea`](https://github.com/taskforcesh/bullmq/commit/57b37ea886c9d86912f49d2d8d77cf3f97eda265))

* chore: remove api symlink ([`6731f8a`](https://github.com/taskforcesh/bullmq/commit/6731f8a36e2ea88f448034194347ffbeb857d17c))

* chore: add api-extractor config ([`6850f87`](https://github.com/taskforcesh/bullmq/commit/6850f874d4b1bcac6fad5df3bc6f5b6f427c2370))

* chore: improvements in semantic release ([`bdb53a3`](https://github.com/taskforcesh/bullmq/commit/bdb53a3b5f895d242a17ee878eda2b1f50f5d45f))

### Documentation

* docs: fix summary ([`3a8873b`](https://github.com/taskforcesh/bullmq/commit/3a8873b6453405e6f8e57331f6cee30977406670))

* docs: fix api reference ([`b06cb1b`](https://github.com/taskforcesh/bullmq/commit/b06cb1be01701050d6cf9a0195872bc6ea0019b1))

### Feature

* feat(job): expose extendLock as a public method ([`17e8431`](https://github.com/taskforcesh/bullmq/commit/17e8431af8bba58612bf9913c63ab5d38afecbb9))

### Unknown

* GitBook: [master] 34 pages modified ([`ea1459d`](https://github.com/taskforcesh/bullmq/commit/ea1459d7332846d920c2040c830c67b86c60225b))


## v1.13.0 (2020-12-30)

### Chore

* chore(deps-dev): bump semantic-release from 15.14.0 to 17.2.3

Bumps [semantic-release](https://github.com/semantic-release/semantic-release) from 15.14.0 to 17.2.3.
- [Release notes](https://github.com/semantic-release/semantic-release/releases)
- [Commits](https://github.com/semantic-release/semantic-release/compare/v15.14.0...v17.2.3)

Signed-off-by: dependabot[bot] &lt;support@github.com&gt; ([`d0b23c7`](https://github.com/taskforcesh/bullmq/commit/d0b23c7f408a8a7b99eaa1215847f4addef9f635))

* chore: re-added changelog ([`4030dab`](https://github.com/taskforcesh/bullmq/commit/4030dab9a7bdcaa85408a5df1136374bcd0b9198))

* chore: moved CHANGELOG ([`d50e14a`](https://github.com/taskforcesh/bullmq/commit/d50e14a6277f903cdac44d71da196f392652e5d6))

* chore: add CHANGELOG.md as a symbolic link in gitbook ([`008e343`](https://github.com/taskforcesh/bullmq/commit/008e34306267194e418c546aee5967f60c875df0))

* chore: remove changelog from gitbook root ([`e19f270`](https://github.com/taskforcesh/bullmq/commit/e19f270985e131058f86c0b2eae0bb26c87e5e8b))

* chore: remove changelog link ([`20f15a6`](https://github.com/taskforcesh/bullmq/commit/20f15a600b3cada3092d42e01044f6b8caec97f8))

### Documentation

* docs: generate api documentation ([`ec6634f`](https://github.com/taskforcesh/bullmq/commit/ec6634ff96877c2629ace25827f4462f6894751d))

* docs: replace link to crontab generator, which used the wrong format. (#307) ([`de99a07`](https://github.com/taskforcesh/bullmq/commit/de99a07c33b2c893466e81b0ed724b3e3e5ffbcd))

* docs: add CHANGELOG.md to the summary ([`75888bd`](https://github.com/taskforcesh/bullmq/commit/75888bdc779020bb8b5034572f8e222b78f407ca))

* docs: remove api redirect ([`dcadb10`](https://github.com/taskforcesh/bullmq/commit/dcadb10b8fdcb85af343d6a129ccd182cb7051a5))

* docs: add changelog to gitbook ([`7b9ab79`](https://github.com/taskforcesh/bullmq/commit/7b9ab7975d755181780629c641a340ca4c478b81))

* docs: fix paths to changelog and api ([`d3a951f`](https://github.com/taskforcesh/bullmq/commit/d3a951fdbd41d2bce7fd17b362971042e8280dc9))

### Feature

* feat: add support for manually processing jobs fixes #327 ([`e42bfd2`](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`d72c40c`](https://github.com/taskforcesh/bullmq/commit/d72c40c638e85febd0b532753af7a6abed9fe3d6))

* GitBook: [master] 2 pages modified ([`39e8f4d`](https://github.com/taskforcesh/bullmq/commit/39e8f4d498b004564e413458a910952ff1013748))

* GitBook: [master] 3 pages modified ([`ab94522`](https://github.com/taskforcesh/bullmq/commit/ab94522d1ede8976ad4662e76aae404ac947bb00))


## v1.12.3 (2020-12-28)

### Chore

* chore(release): 1.12.3 [skip ci]nn## [1.12.3](https://github.com/taskforcesh/bullmq/compare/v1.12.2...v1.12.3) (2020-12-28)

### Bug Fixes

* correctly handle &#34;falsy&#34; data values fixes [#264](https://github.com/taskforcesh/bullmq/issues/264) ([becad91](https://github.com/taskforcesh/bullmq/commit/becad91350fd4ac01037e5b0d4a8a93724dd8dbd))
* **worker:** setname on worker blocking connection ([645b633](https://github.com/taskforcesh/bullmq/commit/645b6338f5883b0c21ae78007777d86b45422615)) ([`7e84155`](https://github.com/taskforcesh/bullmq/commit/7e841558d9406d4acd6210b4c7e9181fc2b5835b))

* chore: update gitbook redirects ([`c635261`](https://github.com/taskforcesh/bullmq/commit/c63526164ba8ce3d6d1b36ccf99c967b0181a1e2))

### Documentation

* docs: fix typo (#350) ([`3f3cd11`](https://github.com/taskforcesh/bullmq/commit/3f3cd1181817dcaa45d2f81798f5b6a965e2bbbd))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`9b51319`](https://github.com/taskforcesh/bullmq/commit/9b513197e0b4551157718aedf0aae89d783cdd0d))


## v1.12.2 (2020-12-23)

### Chore

* chore(release): 1.12.2 [skip ci]nn## [1.12.2](https://github.com/taskforcesh/bullmq/compare/v1.12.1...v1.12.2) (2020-12-23)

### Bug Fixes

* catch errors from Repeat ([#348](https://github.com/taskforcesh/bullmq/issues/348)) ([09a1a98](https://github.com/taskforcesh/bullmq/commit/09a1a98fc42dc1a9ae98bfb29c0cca3fac02013f)) ([`971a079`](https://github.com/taskforcesh/bullmq/commit/971a079b1b9e3c1b962821bf759dc8c7c9792a94))

### Fix

* fix: catch errors from Repeat (#348) ([`09a1a98`](https://github.com/taskforcesh/bullmq/commit/09a1a98fc42dc1a9ae98bfb29c0cca3fac02013f))

### Unknown

* GitBook: [master] 32 pages modified ([`eef4488`](https://github.com/taskforcesh/bullmq/commit/eef4488891bd19b46dff42d821b17292ff957ce2))

* GitBook: [master] 2 pages and 2 assets modified ([`11c5e60`](https://github.com/taskforcesh/bullmq/commit/11c5e6058ab533daa714a27f02d411c3ed63c338))


## v1.12.1 (2020-12-21)

### Chore

* chore(release): 1.12.1 [skip ci]nn## [1.12.1](https://github.com/taskforcesh/bullmq/compare/v1.12.0...v1.12.1) (2020-12-21)

### Bug Fixes

* correctly handle &#34;falsy&#34; data values fixes [#264](https://github.com/taskforcesh/bullmq/issues/264) ([cf1dbaf](https://github.com/taskforcesh/bullmq/commit/cf1dbaf7e60d74fc8443a5f8a537455f28a8dba3)) ([`cc1471e`](https://github.com/taskforcesh/bullmq/commit/cc1471ed703b80da8324b7f29404a1120f27d826))

### Fix

* fix: correctly handle &#34;falsy&#34; data values fixes #264 ([`cf1dbaf`](https://github.com/taskforcesh/bullmq/commit/cf1dbaf7e60d74fc8443a5f8a537455f28a8dba3))

* fix: correctly handle &#34;falsy&#34; data values fixes #264 ([`becad91`](https://github.com/taskforcesh/bullmq/commit/becad91350fd4ac01037e5b0d4a8a93724dd8dbd))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`64985aa`](https://github.com/taskforcesh/bullmq/commit/64985aa6b5d86d9a15304bab7e732b15b720fec4))

* GitBook: [master] one page modified ([`ff318de`](https://github.com/taskforcesh/bullmq/commit/ff318dea01b14896ad2f47981973c707d744aa1f))

* GitBook: [master] 32 pages modified ([`db84a0b`](https://github.com/taskforcesh/bullmq/commit/db84a0b0b80fd3641494d4ae7fd66c880d1bac7e))

* GitBook: [master] 2 pages modified ([`cca32ec`](https://github.com/taskforcesh/bullmq/commit/cca32ec90fbe6225241e2867198b5c981341c4ec))

* GitBook: [master] one page modified ([`e2bcb1e`](https://github.com/taskforcesh/bullmq/commit/e2bcb1eba830e0687cd2ac1a9eb6208bec2ac6e2))

* GitBook: [master] 32 pages and 2 assets modified ([`92f257e`](https://github.com/taskforcesh/bullmq/commit/92f257eff137778f8932e76194f993245360a78f))


## v1.12.0 (2020-12-16)

### Chore

* chore(release): 1.12.0 [skip ci]nn# [1.12.0](https://github.com/taskforcesh/bullmq/compare/v1.11.2...v1.12.0) (2020-12-16)

### Features

* add ability to get if queue is paused or not ([e98b7d8](https://github.com/taskforcesh/bullmq/commit/e98b7d8973df830cc29e0afc5d86e82c9a7ce76f)) ([`c853787`](https://github.com/taskforcesh/bullmq/commit/c85378794f58574d4b382001f457388e5af8f90b))

### Feature

* feat: add ability to get if queue is paused or not ([`e98b7d8`](https://github.com/taskforcesh/bullmq/commit/e98b7d8973df830cc29e0afc5d86e82c9a7ce76f))


## v1.11.2 (2020-12-15)

### Chore

* chore(release): 1.11.2 [skip ci]nn## [1.11.2](https://github.com/taskforcesh/bullmq/compare/v1.11.1...v1.11.2) (2020-12-15)

### Bug Fixes

* promote jobs to the right &#34;list&#34; when paused ([d3df615](https://github.com/taskforcesh/bullmq/commit/d3df615d37b1114c02eacb45f23643ee2f05374d)) ([`49fe957`](https://github.com/taskforcesh/bullmq/commit/49fe95787794e5778bbffd04afe9ba23dc9c9db8))

### Fix

* fix: promote jobs to the right &#34;list&#34; when paused ([`d3df615`](https://github.com/taskforcesh/bullmq/commit/d3df615d37b1114c02eacb45f23643ee2f05374d))


## v1.11.1 (2020-12-15)

### Chore

* chore(release): 1.11.1 [skip ci]nn## [1.11.1](https://github.com/taskforcesh/bullmq/compare/v1.11.0...v1.11.1) (2020-12-15)

### Bug Fixes

* clientCommandMessageReg to support GCP memorystore v5 ([8408dda](https://github.com/taskforcesh/bullmq/commit/8408dda9fa64fc0b968e88fb2726e0a30f717ed7)) ([`9aba722`](https://github.com/taskforcesh/bullmq/commit/9aba722f41b390b5a5eeeeeba7c51b4f87cd87c7))

* chore(deps): bump ini from 1.3.5 to 1.3.7

Bumps [ini](https://github.com/isaacs/ini) from 1.3.5 to 1.3.7.
- [Release notes](https://github.com/isaacs/ini/releases)
- [Commits](https://github.com/isaacs/ini/compare/v1.3.5...v1.3.7)

Signed-off-by: dependabot[bot] &lt;support@github.com&gt; ([`b0121b2`](https://github.com/taskforcesh/bullmq/commit/b0121b216a5853acd88c7948541d2f8678a4a91f))

### Documentation

* docs: add instructions for npm install ([`f1203ff`](https://github.com/taskforcesh/bullmq/commit/f1203ffda233e6b3dbe5dea52f8f8c073760f86f))

* docs: fix a typo in guide/workers.md (#328) ([`1c17c02`](https://github.com/taskforcesh/bullmq/commit/1c17c02de0036e434f2900142eb87a92daac36d9))

* docs: fix redis default port ([`7372ef1`](https://github.com/taskforcesh/bullmq/commit/7372ef16465fdf7d3c803a9cd9c1a25422d53373))

### Fix

* fix: clientCommandMessageReg to support GCP memorystore v5 ([`8408dda`](https://github.com/taskforcesh/bullmq/commit/8408dda9fa64fc0b968e88fb2726e0a30f717ed7))

### Unknown

* GitBook: [master] 4 pages and 2 assets modified ([`6570def`](https://github.com/taskforcesh/bullmq/commit/6570def1b073a19a68073754ff18fe38d3254060))

* GitBook: [master] 30 pages modified ([`56f89bf`](https://github.com/taskforcesh/bullmq/commit/56f89bfc6862947f787ec7ec7e86eea4eff9e121))


## v1.11.0 (2020-11-24)

### Chore

* chore(release): 1.11.0 [skip ci]nn# [1.11.0](https://github.com/taskforcesh/bullmq/compare/v1.10.0...v1.11.0) (2020-11-24)

### Bug Fixes

* add generic type to processor ([d4f6501](https://github.com/taskforcesh/bullmq/commit/d4f650120804bd6161f0eeda5162ad5a96811a05))

### Features

* add name and return types to queue, worker and processor ([4879715](https://github.com/taskforcesh/bullmq/commit/4879715ec7c917f11e3a0ac3c5f5126029340ed3)) ([`4495e1d`](https://github.com/taskforcesh/bullmq/commit/4495e1d301e2c16310afabc42ebd284b9ad20363))

### Documentation

* docs: add a remark about scheduler for retries to work (#316) ([`6e29fcd`](https://github.com/taskforcesh/bullmq/commit/6e29fcd2d79aff5e400d9bee83a597b8cf57d39c))

### Feature

* feat: add name and return types to queue, worker and processor ([`4879715`](https://github.com/taskforcesh/bullmq/commit/4879715ec7c917f11e3a0ac3c5f5126029340ed3))

### Fix

* fix: add generic type to processor ([`d4f6501`](https://github.com/taskforcesh/bullmq/commit/d4f650120804bd6161f0eeda5162ad5a96811a05))

### Unknown

* GitBook: [master] one page modified ([`3b6681b`](https://github.com/taskforcesh/bullmq/commit/3b6681b911d0eab332f6e65d4997e54cce255d7a))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`34c803f`](https://github.com/taskforcesh/bullmq/commit/34c803fcaa4fe96e0ac8515287c8b9c49f139d89))

* GitBook: [master] 28 pages modified ([`bf54c65`](https://github.com/taskforcesh/bullmq/commit/bf54c6504ac45633d91b431272f5ad1c1e343264))

* GitBook: [master] one page modified ([`b564337`](https://github.com/taskforcesh/bullmq/commit/b564337cccc1b5e8d7f0734938616674d54fd6da))

* Update README.md ([`d61db4a`](https://github.com/taskforcesh/bullmq/commit/d61db4a4d9bab3a6b33100a362359376fabe6eba))


## v1.10.0 (2020-10-20)

### Build

* build: sort script targets, rename prepublish target to prepare ([`f52a33a`](https://github.com/taskforcesh/bullmq/commit/f52a33a3f4dddc83c5146018b645d5873f63b87a))

### Chore

* chore(release): 1.10.0 [skip ci]nn# [1.10.0](https://github.com/taskforcesh/bullmq/compare/v1.9.0...v1.10.0) (2020-10-20)

### Bug Fixes

* **job:** remove listeners before resolving promise ([563ce92](https://github.com/taskforcesh/bullmq/commit/563ce9218f5dd81f2bc836f9e8ccdedc549f09dd))
* **worker:** continue processing if handleFailed fails. fixes [#286](https://github.com/taskforcesh/bullmq/issues/286) ([4ef1cbc](https://github.com/taskforcesh/bullmq/commit/4ef1cbc13d53897b57ae3d271afbaa1b213824aa))
* **worker:** fix memory leak on Promise.race ([#282](https://github.com/taskforcesh/bullmq/issues/282)) ([a78ab2b](https://github.com/taskforcesh/bullmq/commit/a78ab2b362e54f897eec6c8b16f16ecccf7875c2))
* **worker:** setname on worker blocking connection ([#291](https://github.com/taskforcesh/bullmq/issues/291)) ([50a87fc](https://github.com/taskforcesh/bullmq/commit/50a87fcb1dab976a6a0273d2b0cc4b31b63c015f))
* remove async for loop in child pool fixes [#229](https://github.com/taskforcesh/bullmq/issues/229) ([d77505e](https://github.com/taskforcesh/bullmq/commit/d77505e989cd1395465c5222613555f79e4d9720))

### Features

* **sandbox:** kill child workers gracefully ([#243](https://github.com/taskforcesh/bullmq/issues/243)) ([4262837](https://github.com/taskforcesh/bullmq/commit/4262837bc67e007fe44606670dce48ee7fec65cd)) ([`c03219c`](https://github.com/taskforcesh/bullmq/commit/c03219c38fcf42957b705384dd1fb4bfaa86b075))

* chore: use yarn not npm ([`428504a`](https://github.com/taskforcesh/bullmq/commit/428504a132b52626be39901d0b1cf22a010c877c))

* chore: correct release steps ([`01570f1`](https://github.com/taskforcesh/bullmq/commit/01570f196733e3ab0f1472361fa86b88e96efbc3))

* chore: move from travis to github workflows ([`5e278b6`](https://github.com/taskforcesh/bullmq/commit/5e278b6bbf3397316826b082bce08192aa789017))

### Documentation

* docs: update README ([`1d9940b`](https://github.com/taskforcesh/bullmq/commit/1d9940b23c713cc9bbf8b2ebc767890ee17e8073))

* docs: update README ([`3a1a8e5`](https://github.com/taskforcesh/bullmq/commit/3a1a8e50dedbea545de3786fd1c41b53a300b0a1))

### Feature

* feat(sandbox): kill child workers gracefully (#243) ([`4262837`](https://github.com/taskforcesh/bullmq/commit/4262837bc67e007fe44606670dce48ee7fec65cd))

### Fix

* fix(worker): setname on worker blocking connection (#291) ([`50a87fc`](https://github.com/taskforcesh/bullmq/commit/50a87fcb1dab976a6a0273d2b0cc4b31b63c015f))

* fix(worker): continue processing if handleFailed fails. fixes #286 ([`4ef1cbc`](https://github.com/taskforcesh/bullmq/commit/4ef1cbc13d53897b57ae3d271afbaa1b213824aa))

* fix(worker): setname on worker blocking connection ([`645b633`](https://github.com/taskforcesh/bullmq/commit/645b6338f5883b0c21ae78007777d86b45422615))

* fix(job): remove listeners before resolving promise ([`563ce92`](https://github.com/taskforcesh/bullmq/commit/563ce9218f5dd81f2bc836f9e8ccdedc549f09dd))

* fix(worker): fix memory leak on Promise.race (#282) ([`a78ab2b`](https://github.com/taskforcesh/bullmq/commit/a78ab2b362e54f897eec6c8b16f16ecccf7875c2))

* fix: remove async for loop in child pool fixes #229 ([`d77505e`](https://github.com/taskforcesh/bullmq/commit/d77505e989cd1395465c5222613555f79e4d9720))

### Test

* test: increase timeout on child retain tests (#293) ([`0c72e08`](https://github.com/taskforcesh/bullmq/commit/0c72e0884b3e0b66d86a2fb94ff98b1def240b3e))

### Unknown

* Update README.md ([`3a3a66f`](https://github.com/taskforcesh/bullmq/commit/3a3a66f31dbd11c69034aee3b9afa3c1e83200b8))

* Update README.md ([`461f441`](https://github.com/taskforcesh/bullmq/commit/461f4414c4fbc7439b64e08677d1a935d6a97a1a))

* Update README.md ([`5eae7e6`](https://github.com/taskforcesh/bullmq/commit/5eae7e6054da612e64eefde58598d568814c0969))

* Update README.md ([`902a038`](https://github.com/taskforcesh/bullmq/commit/902a038dd158bfdab2166e7e2aa62c9109f62843))

* Update README.md ([`9de5cfa`](https://github.com/taskforcesh/bullmq/commit/9de5cfa1123f0b3284488d0ae078d38b3d0b1513))

* GitBook: [master] 29 pages modified ([`297ec30`](https://github.com/taskforcesh/bullmq/commit/297ec30086bd0d95b10718c128409e535414180f))

* GitBook: [master] one page modified ([`abaa7f7`](https://github.com/taskforcesh/bullmq/commit/abaa7f725c1cf4efb124115fdca10f194c52f805))

* GitBook: [master] one page modified ([`0866c8c`](https://github.com/taskforcesh/bullmq/commit/0866c8c0f8de74b80fac29a30a146c5af8a0ddf9))

* GitBook: [master] 3 pages modified ([`5e30929`](https://github.com/taskforcesh/bullmq/commit/5e30929b747609caa7ce9c13087b6f04a3b42d2d))

* GitBook: [master] one page modified ([`3fcb0ac`](https://github.com/taskforcesh/bullmq/commit/3fcb0acaa2fd32f5a2acbbb50dfd077545eb6cb8))

* GitBook: [master] one page modified ([`89243b5`](https://github.com/taskforcesh/bullmq/commit/89243b52c4beb23e7be4e6cfe283d7eb01663a21))

* GitBook: [master] 10 pages and one asset modified ([`3121a00`](https://github.com/taskforcesh/bullmq/commit/3121a000dca00364b881dbdd02ddd42cec4b7865))


## v1.9.0 (2020-07-19)

### Chore

* chore(release): 1.9.0 [skip ci]nn# [1.9.0](https://github.com/taskforcesh/bullmq/compare/v1.8.14...v1.9.0) (2020-07-19)

### Features

* add grouped rate limiting ([3a958dd](https://github.com/taskforcesh/bullmq/commit/3a958dd30d09a049b0d761679d3b8d92709e815e)) ([`30aa033`](https://github.com/taskforcesh/bullmq/commit/30aa0330dd2a8fbe3f692b3e3fc6091a4f0593af))

* chore(deps): bump lodash from 4.17.15 to 4.17.19

Bumps [lodash](https://github.com/lodash/lodash) from 4.17.15 to 4.17.19.
- [Release notes](https://github.com/lodash/lodash/releases)
- [Commits](https://github.com/lodash/lodash/compare/4.17.15...4.17.19)

Signed-off-by: dependabot[bot] &lt;support@github.com&gt; ([`7f986fc`](https://github.com/taskforcesh/bullmq/commit/7f986fc17c067263238fbe1e285ff0ef08570445))

### Feature

* feat: add grouped rate limiting ([`3a958dd`](https://github.com/taskforcesh/bullmq/commit/3a958dd30d09a049b0d761679d3b8d92709e815e))


## v1.8.14 (2020-07-03)

### Chore

* chore(release): 1.8.14 [skip ci]nn## [1.8.14](https://github.com/taskforcesh/bullmq/compare/v1.8.13...v1.8.14) (2020-07-03)

### Bug Fixes

* **typescript:** fix typings, upgrade ioredis dependencies ([#220](https://github.com/taskforcesh/bullmq/issues/220)) ([7059f20](https://github.com/taskforcesh/bullmq/commit/7059f2089553a206ab3937f7fd0d0b9de96aa7b7))
* **worker:** return this.closing when calling close ([b68c845](https://github.com/taskforcesh/bullmq/commit/b68c845c77de6b2973ec31d2f22958ab60ad87aa)) ([`3f3f2a9`](https://github.com/taskforcesh/bullmq/commit/3f3f2a9563387312e7dd14a0efaa5f87ff3b71c3))

### Fix

* fix(typescript): fix typings, upgrade ioredis dependencies (#220) ([`7059f20`](https://github.com/taskforcesh/bullmq/commit/7059f2089553a206ab3937f7fd0d0b9de96aa7b7))

### Test

* test(getters): check length of get failed jobs ([`9296516`](https://github.com/taskforcesh/bullmq/commit/9296516cbb212d6a24422cc9a76109e89c12915e))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`d280be9`](https://github.com/taskforcesh/bullmq/commit/d280be98f491ca074cf63a3324ad6d09046babcf))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`c6e0188`](https://github.com/taskforcesh/bullmq/commit/c6e018808254ed8011adc8bd11822f34797f77e5))

* Update queue.ts ([`2da059d`](https://github.com/taskforcesh/bullmq/commit/2da059df47c55074036fdbf347cd5ee38971487c))


## v1.8.13 (2020-06-05)

### Chore

* chore(release): 1.8.13 [skip ci]nn## [1.8.13](https://github.com/taskforcesh/bullmq/compare/v1.8.12...v1.8.13) (2020-06-05)

### Bug Fixes

* **redis-connection:** run the load command for reused redis client ([fab9bba](https://github.com/taskforcesh/bullmq/commit/fab9bba4caee8fd44523febb3bde588b151e8514)) ([`47d0827`](https://github.com/taskforcesh/bullmq/commit/47d0827b225bab4420647bfcd5eb551db0175269))

### Fix

* fix(redis-connection): run the load command for reused redis client ([`fab9bba`](https://github.com/taskforcesh/bullmq/commit/fab9bba4caee8fd44523febb3bde588b151e8514))


## v1.8.12 (2020-06-04)

### Chore

* chore(release): 1.8.12 [skip ci]nn## [1.8.12](https://github.com/taskforcesh/bullmq/compare/v1.8.11...v1.8.12) (2020-06-04)

### Bug Fixes

* remove unused options ([23aadc3](https://github.com/taskforcesh/bullmq/commit/23aadc300b947693f4afb22296d236a924bd11ca)) ([`5e808ad`](https://github.com/taskforcesh/bullmq/commit/5e808ad92ab510400b4f5f223db3e0b4ed6af09c))

### Documentation

* docs: update README.md (#217) ([`55fff7f`](https://github.com/taskforcesh/bullmq/commit/55fff7f7c370186752710e20534ded3e17962cf8))

* docs: improve QueueScheduler docs

I know that this looks obvious but it was not so direct to find it on the docs ([`873ec2f`](https://github.com/taskforcesh/bullmq/commit/873ec2f44eaf522c645241af3fed071ded5a2c43))

### Fix

* fix: remove unused options ([`23aadc3`](https://github.com/taskforcesh/bullmq/commit/23aadc300b947693f4afb22296d236a924bd11ca))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`46291ce`](https://github.com/taskforcesh/bullmq/commit/46291ce5b16eebb28da1c82dec2d62d4ca2a6351))


## v1.8.11 (2020-05-29)

### Chore

* chore(release): 1.8.11 [skip ci]nn## [1.8.11](https://github.com/taskforcesh/bullmq/compare/v1.8.10...v1.8.11) (2020-05-29)

### Bug Fixes

* **scheduler:** remove unnecessary division by 4096 ([4d25e95](https://github.com/taskforcesh/bullmq/commit/4d25e95f9522388bd85e932e04b6668e3da57686)) ([`c608a3f`](https://github.com/taskforcesh/bullmq/commit/c608a3fdf7e7c9031998a5695d387eb2a7797b6f))

### Fix

* fix(scheduler): remove unnecessary division by 4096 ([`4d25e95`](https://github.com/taskforcesh/bullmq/commit/4d25e95f9522388bd85e932e04b6668e3da57686))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`fc9d13f`](https://github.com/taskforcesh/bullmq/commit/fc9d13f7d8ce9cacefea516be9ad73b43ba9079d))


## v1.8.10 (2020-05-28)

### Chore

* chore(release): 1.8.10 [skip ci]nn## [1.8.10](https://github.com/taskforcesh/bullmq/compare/v1.8.9...v1.8.10) (2020-05-28)

### Bug Fixes

* **scheduler:** divide timestamp by 4096 in update set fixes [#168](https://github.com/taskforcesh/bullmq/issues/168) ([0c5db83](https://github.com/taskforcesh/bullmq/commit/0c5db8391bb8994bee19f25a33efb9dfee792d7b)) ([`183137a`](https://github.com/taskforcesh/bullmq/commit/183137a8f4c9dafada20096ee07aba4bd1ecb35a))

### Fix

* fix(scheduler): divide timestamp by 4096 in update set fixes #168 ([`0c5db83`](https://github.com/taskforcesh/bullmq/commit/0c5db8391bb8994bee19f25a33efb9dfee792d7b))


## v1.8.9 (2020-05-25)

### Chore

* chore(release): 1.8.9 [skip ci]nn## [1.8.9](https://github.com/taskforcesh/bullmq/compare/v1.8.8...v1.8.9) (2020-05-25)

### Bug Fixes

* **scheduler:** divide next timestamp  by 4096 ([#204](https://github.com/taskforcesh/bullmq/issues/204)) ([9562d74](https://github.com/taskforcesh/bullmq/commit/9562d74625e20b7b6de8750339c85345ba027357)) ([`e126c25`](https://github.com/taskforcesh/bullmq/commit/e126c25e61b36f484a7b4b753be4789001b8dcf8))

* chore(deps): bump jquery from 3.4.1 to 3.5.1

Bumps [jquery](https://github.com/jquery/jquery) from 3.4.1 to 3.5.1.
- [Release notes](https://github.com/jquery/jquery/releases)
- [Commits](https://github.com/jquery/jquery/compare/3.4.1...3.5.1)

Signed-off-by: dependabot[bot] &lt;support@github.com&gt; ([`6ec5517`](https://github.com/taskforcesh/bullmq/commit/6ec5517d5de6a55482f0fb598367b64c1c65cdef))

### Fix

* fix(scheduler): divide next timestamp  by 4096 (#204)

authored-by: Boris Dorofeev &lt;bdorofeev@bdorofeev-laptop.corp.ps.kz&gt; ([`9562d74`](https://github.com/taskforcesh/bullmq/commit/9562d74625e20b7b6de8750339c85345ba027357))


## v1.8.8 (2020-05-25)

### Chore

* chore(release): 1.8.8 [skip ci]nn## [1.8.8](https://github.com/taskforcesh/bullmq/compare/v1.8.7...v1.8.8) (2020-05-25)

### Bug Fixes

* **queue-base:** error event is passed through ([ad14e77](https://github.com/taskforcesh/bullmq/commit/ad14e777171c0c44b7e50752d9847dec23f46158))
* **redis-connection:** error event is passed through ([a15b1a1](https://github.com/taskforcesh/bullmq/commit/a15b1a1824c6863ecf3e5132e22924fc3ff161f6))
* **worker:** error event is passed through ([d7f0374](https://github.com/taskforcesh/bullmq/commit/d7f03749ce300e917399a435a3f426e66145dd8c)) ([`75eeef2`](https://github.com/taskforcesh/bullmq/commit/75eeef2031fb862fd35b769cf81d12642bad811c))

### Fix

* fix(redis-connection): error event is passed through ([`a15b1a1`](https://github.com/taskforcesh/bullmq/commit/a15b1a1824c6863ecf3e5132e22924fc3ff161f6))

* fix(worker): error event is passed through ([`d7f0374`](https://github.com/taskforcesh/bullmq/commit/d7f03749ce300e917399a435a3f426e66145dd8c))

* fix(queue-base): error event is passed through

Existing code doesn&#39;t seem to pass &#39;error&#39; event through in a right way. ([`ad14e77`](https://github.com/taskforcesh/bullmq/commit/ad14e777171c0c44b7e50752d9847dec23f46158))

### Test

* test: fix broken connection test ([`230664c`](https://github.com/taskforcesh/bullmq/commit/230664cf0565e2d5351299d64d3a8bef70289b0f))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`5d4e983`](https://github.com/taskforcesh/bullmq/commit/5d4e9835bd74500699bbe7300e17cb094911e4f6))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`96201b3`](https://github.com/taskforcesh/bullmq/commit/96201b392c590dfdbbd8001a94d124a2567165bf))

* update events.md

Correctly instantiate the `Worker` class, ([`2a439fb`](https://github.com/taskforcesh/bullmq/commit/2a439fbe44e0e08544d1d34d78dd8999cd4ca83b))

* Second Argument for worker is missing

I am not sure exactly the options here, but definitely this will work.  It also appears that some sort of resolution might occur if a string is passed, but I can&#39;t figure that one out. ([`8ee4d68`](https://github.com/taskforcesh/bullmq/commit/8ee4d685dec7a92f050d752f29375b5f58cc6c72))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`2971254`](https://github.com/taskforcesh/bullmq/commit/2971254dcabada77b815affb377639abb5d6f990))


## v1.8.7 (2020-04-10)

### Chore

* chore(release): 1.8.7 [skip ci]nn## [1.8.7](https://github.com/taskforcesh/bullmq/compare/v1.8.6...v1.8.7) (2020-04-10)

### Bug Fixes

* **worker:** do not use global child pool fixes [#172](https://github.com/taskforcesh/bullmq/issues/172) ([bc65f26](https://github.com/taskforcesh/bullmq/commit/bc65f26dd47c59d0a7277ac947140405557be9a5)) ([`5ef3e12`](https://github.com/taskforcesh/bullmq/commit/5ef3e12afc936b0db23de6787cf62ec9bd262f42))

### Fix

* fix(worker): do not use global child pool fixes #172 ([`bc65f26`](https://github.com/taskforcesh/bullmq/commit/bc65f26dd47c59d0a7277ac947140405557be9a5))

### Unknown

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`b80678d`](https://github.com/taskforcesh/bullmq/commit/b80678d22f12b79b5f7fabce9e445a929ec2f289))


## v1.8.6 (2020-04-10)

### Chore

* chore(release): 1.8.6 [skip ci]nn## [1.8.6](https://github.com/taskforcesh/bullmq/compare/v1.8.5...v1.8.6) (2020-04-10)

### Bug Fixes

* **workers:** do not call super.close() ([ebd2ae1](https://github.com/taskforcesh/bullmq/commit/ebd2ae1a5613d71643c5a7ba3f685d77585de68e))
* make sure closing is returned in every close call ([88c5948](https://github.com/taskforcesh/bullmq/commit/88c5948d33a9a7b7a4f4f64f3183727b87d80207))
* **scheduler:** duplicate connections fixes [#174](https://github.com/taskforcesh/bullmq/issues/174) ([011b8ac](https://github.com/taskforcesh/bullmq/commit/011b8acfdec54737d94a9fead2423e060e3364db))
* **worker:** return this.closing when calling close ([06d3d4f](https://github.com/taskforcesh/bullmq/commit/06d3d4f476444a2d2af8538d60cb2561a1915868)) ([`4654721`](https://github.com/taskforcesh/bullmq/commit/46547217fe04853b50d29b83d95c1e6f29a184de))

### Fix

* fix(workers): do not call super.close() ([`ebd2ae1`](https://github.com/taskforcesh/bullmq/commit/ebd2ae1a5613d71643c5a7ba3f685d77585de68e))

* fix: make sure closing is returned in every close call ([`88c5948`](https://github.com/taskforcesh/bullmq/commit/88c5948d33a9a7b7a4f4f64f3183727b87d80207))

* fix(worker): return this.closing when calling close ([`06d3d4f`](https://github.com/taskforcesh/bullmq/commit/06d3d4f476444a2d2af8538d60cb2561a1915868))

### Test

* test(stalled_jobs): finetune params ([`d7888ae`](https://github.com/taskforcesh/bullmq/commit/d7888ae8efe9ff3427605e0937862bce930cd27b))

* test(stalled_jobs): increase timeout ([`8f654f9`](https://github.com/taskforcesh/bullmq/commit/8f654f95ba2e7f08c3f780c94d69e8c15adec641))

### Unknown

*  fix(scheduler): duplicate connections fixes #174 ([`011b8ac`](https://github.com/taskforcesh/bullmq/commit/011b8acfdec54737d94a9fead2423e060e3364db))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`fff60bf`](https://github.com/taskforcesh/bullmq/commit/fff60bf2962a6a4708081ed57772c413adb3a43c))


## v1.8.5 (2020-04-05)

### Chore

* chore(release): 1.8.5 [skip ci]nn## [1.8.5](https://github.com/taskforcesh/bullmq/compare/v1.8.4...v1.8.5) (2020-04-05)

### Bug Fixes

* removed deprecated and unused node-uuid ([c810579](https://github.com/taskforcesh/bullmq/commit/c810579029d33ef47d5a7563e63126a69c62fd87)) ([`88ef30b`](https://github.com/taskforcesh/bullmq/commit/88ef30b1ff2ec0a037bf2cd69e8558687bbeb70e))

### Fix

* fix: removed deprecated and unused node-uuid ([`c810579`](https://github.com/taskforcesh/bullmq/commit/c810579029d33ef47d5a7563e63126a69c62fd87))


## v1.8.4 (2020-03-17)

### Chore

* chore(release): 1.8.4 [skip ci]nn## [1.8.4](https://github.com/taskforcesh/bullmq/compare/v1.8.3...v1.8.4) (2020-03-17)

### Bug Fixes

* **job:** added nullable/optional properties ([cef134f](https://github.com/taskforcesh/bullmq/commit/cef134f7c4d87e1b80ba42a5e06c3877956ff4cc)) ([`5c656cb`](https://github.com/taskforcesh/bullmq/commit/5c656cb231e0d001f3c18937cfb6b11b1f4f480d))

### Fix

* fix(job): added nullable/optional properties

Marked finishedOn and processedOn as nullable/optional ([`cef134f`](https://github.com/taskforcesh/bullmq/commit/cef134f7c4d87e1b80ba42a5e06c3877956ff4cc))


## v1.8.3 (2020-03-13)

### Chore

* chore(release): 1.8.3 [skip ci]nn## [1.8.3](https://github.com/taskforcesh/bullmq/compare/v1.8.2...v1.8.3) (2020-03-13)

### Bug Fixes

* **sandbox:** If the child process is killed, remove it from the pool. ([8fb0fb5](https://github.com/taskforcesh/bullmq/commit/8fb0fb569a0236b37d3bae06bf58a2a1da3221c6)) ([`acf3159`](https://github.com/taskforcesh/bullmq/commit/acf3159650b9afabc23db4db6d8a445e3ec02b72))

### Fix

* fix(sandbox): If the child process is killed, remove it from the pool. ([`8fb0fb5`](https://github.com/taskforcesh/bullmq/commit/8fb0fb569a0236b37d3bae06bf58a2a1da3221c6))


## v1.8.2 (2020-03-03)

### Chore

* chore(release): 1.8.2 [skip ci]nn## [1.8.2](https://github.com/taskforcesh/bullmq/compare/v1.8.1...v1.8.2) (2020-03-03)

### Bug Fixes

* restore the Job timestamp when deserializing JSON data ([#138](https://github.com/taskforcesh/bullmq/issues/138)) ([#152](https://github.com/taskforcesh/bullmq/issues/152)) ([c171bd4](https://github.com/taskforcesh/bullmq/commit/c171bd47f7b75378e75307a1decdc0f630ac1cd6)) ([`b96f5ba`](https://github.com/taskforcesh/bullmq/commit/b96f5ba3e9c36182174300af629b34fe43c62ecd))

### Fix

* fix: restore the Job timestamp when deserializing JSON data (#138) (#152) ([`c171bd4`](https://github.com/taskforcesh/bullmq/commit/c171bd47f7b75378e75307a1decdc0f630ac1cd6))

* fix(worker): return this.closing when calling close ([`b68c845`](https://github.com/taskforcesh/bullmq/commit/b68c845c77de6b2973ec31d2f22958ab60ad87aa))


## v1.8.1 (2020-03-02)

### Chore

* chore(release): 1.8.1 [skip ci]nn## [1.8.1](https://github.com/taskforcesh/bullmq/compare/v1.8.0...v1.8.1) (2020-03-02)

### Bug Fixes

* modified imports to work when esModuleInterop is disabled ([#132](https://github.com/taskforcesh/bullmq/issues/132)) ([01681f2](https://github.com/taskforcesh/bullmq/commit/01681f282bafac2df2c602edb51d6bde3483896c)) ([`fccacee`](https://github.com/taskforcesh/bullmq/commit/fccacee7164155ea1fdf5bee163dd56103cfb223))

### Fix

* fix: modified imports to work when esModuleInterop is disabled (#132)

fixes https://github.com/taskforcesh/bullmq/issues/129 ([`01681f2`](https://github.com/taskforcesh/bullmq/commit/01681f282bafac2df2c602edb51d6bde3483896c))


## v1.8.0 (2020-03-02)

### Chore

* chore(release): 1.8.0 [skip ci]nn# [1.8.0](https://github.com/taskforcesh/bullmq/compare/v1.7.0...v1.8.0) (2020-03-02)

### Bug Fixes

* cleanup signatures for queue add and addBulk ([#127](https://github.com/taskforcesh/bullmq/issues/127)) ([48e221b](https://github.com/taskforcesh/bullmq/commit/48e221b53909079a4def9c48c1b69cebabd0ed74))
* exit code 12 when using inspect with child process ([#137](https://github.com/taskforcesh/bullmq/issues/137)) ([43ebc67](https://github.com/taskforcesh/bullmq/commit/43ebc67cec3e8f283f9a555b4466cf918226687b))

### Features

* **types:** add sandboxed job processor types ([#114](https://github.com/taskforcesh/bullmq/issues/114)) ([a50a88c](https://github.com/taskforcesh/bullmq/commit/a50a88cd1658fa9d568235283a4c23a74eb8ed2a)) ([`5cde2fa`](https://github.com/taskforcesh/bullmq/commit/5cde2faa699344ffa3c948aea2214723eeda37d1))

### Feature

* feat(types): add sandboxed job processor types (#114) ([`a50a88c`](https://github.com/taskforcesh/bullmq/commit/a50a88cd1658fa9d568235283a4c23a74eb8ed2a))

### Fix

* fix: exit code 12 when using inspect with child process (#137) ([`43ebc67`](https://github.com/taskforcesh/bullmq/commit/43ebc67cec3e8f283f9a555b4466cf918226687b))

* fix: cleanup signatures for queue add and addBulk (#127)

The addBulk signature was missing the data type and the name parameter
did not match between the two functions. ([`48e221b`](https://github.com/taskforcesh/bullmq/commit/48e221b53909079a4def9c48c1b69cebabd0ed74))


## v1.7.0 (2020-03-02)

### Chore

* chore(release): 1.7.0 [skip ci]nn# [1.7.0](https://github.com/taskforcesh/bullmq/compare/v1.6.8...v1.7.0) (2020-03-02)

### Features

* made queue name publicly readable for [#140](https://github.com/taskforcesh/bullmq/issues/140) ([f2bba2e](https://github.com/taskforcesh/bullmq/commit/f2bba2efd9d85986b01bb35c847a232b5c42ae57)) ([`dbf19de`](https://github.com/taskforcesh/bullmq/commit/dbf19de422b889574aa055ad08f677050bffb762))

### Unknown

* Merge pull request #141 from bobdercole/queue-name

feat: made queue name publicly readable for #140 ([`def0eb6`](https://github.com/taskforcesh/bullmq/commit/def0eb658821d3eb44e3b69d71cb58e05d251f70))

* Merge branch &#39;master&#39; into queue-name ([`5c202cf`](https://github.com/taskforcesh/bullmq/commit/5c202cf0e62de796b0f3ce6cfec4018042d7744e))


## v1.6.8 (2020-02-22)

### Chore

* chore(release): 1.6.8 [skip ci]nn## [1.6.8](https://github.com/taskforcesh/bullmq/compare/v1.6.7...v1.6.8) (2020-02-22)

### Bug Fixes

* modified QueueGetters.getJob and Job.fromId to also return null to ([65183fc](https://github.com/taskforcesh/bullmq/commit/65183fcf542d0227ec1d4d6637b46b5381331787))
* modified QueueGetters.getJob and Job.fromId to return undefined ([ede352b](https://github.com/taskforcesh/bullmq/commit/ede352be75ffe05bf633516db9eda88467c562bf)) ([`293ef56`](https://github.com/taskforcesh/bullmq/commit/293ef569460d076bdedc62f60e3d520fa6ccab33))

### Documentation

* docs: minor improvements ([`a882a4a`](https://github.com/taskforcesh/bullmq/commit/a882a4ad6b60b5b0fd3dec838f9c35b7e582310d))

* docs: fix QueueEvents examples in quick start guide ([`83c8e28`](https://github.com/taskforcesh/bullmq/commit/83c8e281f7c30caf82fa9c3e21775a507b560378))

### Feature

* feat: made queue name publicly readable for #140 ([`f2bba2e`](https://github.com/taskforcesh/bullmq/commit/f2bba2efd9d85986b01bb35c847a232b5c42ae57))

### Fix

* fix: modified QueueGetters.getJob and Job.fromId to return undefined
instead of null ([`ede352b`](https://github.com/taskforcesh/bullmq/commit/ede352be75ffe05bf633516db9eda88467c562bf))

* fix: modified QueueGetters.getJob and Job.fromId to also return null to
maintain consistency with v3 API. ([`65183fc`](https://github.com/taskforcesh/bullmq/commit/65183fcf542d0227ec1d4d6637b46b5381331787))

### Test

* test: added test for undefined getJob ([`102d7f7`](https://github.com/taskforcesh/bullmq/commit/102d7f705dc28ce0dd467bed46d2e5c4e3523ee8))

* test: re-added getJob test ([`5716279`](https://github.com/taskforcesh/bullmq/commit/57162796a089d76635edf017798190d38b7a9702))

* test: updated tests for ede352b ([`2de620b`](https://github.com/taskforcesh/bullmq/commit/2de620b3eb9f292fc25f88bd1bff55805f832d03))

### Unknown

* Merge pull request #133 from bobdercole/get-job-type

fix: modified QueueGetters.getJob and Job.fromId to also return null ([`10f493e`](https://github.com/taskforcesh/bullmq/commit/10f493e8dfdd4fbf13a288482d8578ba895a1323))

* Merge pull request #125 from snacqs/docs-improvements

docs: minor improvements ([`36726bf`](https://github.com/taskforcesh/bullmq/commit/36726bfb01430af8ec606f36423fc187e4a06fb4))

* Merge pull request #123 from rhinodavid/queue_events_doc

docs: fix QueueEvents examples in quick start guide ([`195e877`](https://github.com/taskforcesh/bullmq/commit/195e8777f35032f106732adc7e5e74dc952f3aa8))


## v1.6.7 (2020-01-16)

### Chore

* chore(release): 1.6.7 [skip ci]nn## [1.6.7](https://github.com/taskforcesh/bullmq/compare/v1.6.6...v1.6.7) (2020-01-16)

### Bug Fixes

* don&#39;t fail a job when the worker already lost the lock ([23c0bf7](https://github.com/taskforcesh/bullmq/commit/23c0bf70eab6d166b0483336f103323d1bf2ca64)) ([`9d796a1`](https://github.com/taskforcesh/bullmq/commit/9d796a14258061e4b52063150e1d307799ce9019))

### Fix

* fix: don&#39;t fail a job when the worker already lost the lock ([`23c0bf7`](https://github.com/taskforcesh/bullmq/commit/23c0bf70eab6d166b0483336f103323d1bf2ca64))

### Unknown

* Merge pull request #107 from wavyapp/fix-71

fix: don&#39;t fail a job when the worker already lost the lock ([`da8cdb4`](https://github.com/taskforcesh/bullmq/commit/da8cdb42827c22fea12b9c2f4c0c80fbad786b98))

* GitBook: [master] 7 pages modified ([`b4a7dfd`](https://github.com/taskforcesh/bullmq/commit/b4a7dfd5691f35b67ce0474169bc02e31431e262))


## v1.6.6 (2020-01-05)

### Chore

* chore(release): 1.6.6 [skip ci]nn## [1.6.6](https://github.com/taskforcesh/bullmq/compare/v1.6.5...v1.6.6) (2020-01-05)

### Bug Fixes

* remove duplicate active entry ([1d2cca3](https://github.com/taskforcesh/bullmq/commit/1d2cca38ee61289adcee4899a91f7dcbc93a7c05)) ([`6553a20`](https://github.com/taskforcesh/bullmq/commit/6553a204dbd9c08e84fc4e173b5363610a789ad5))

### Unknown

* Merge pull request #99 from chrisabrams/fix-dup-entry

[fix] Remove duplicate active entry ([`bddaf44`](https://github.com/taskforcesh/bullmq/commit/bddaf4467dea4ff8583cd6e9cbbb83a6e5330893))

* Merge branch &#39;master&#39; into fix-dup-entry ([`f7712d8`](https://github.com/taskforcesh/bullmq/commit/f7712d8d2a614d5db077eaef19c807e3b550a020))


## v1.6.5 (2020-01-05)

### Chore

* chore(release): 1.6.5 [skip ci]nn## [1.6.5](https://github.com/taskforcesh/bullmq/compare/v1.6.4...v1.6.5) (2020-01-05)

### Bug Fixes

* get rid of flushdb/flushall in tests ([550c67b](https://github.com/taskforcesh/bullmq/commit/550c67b25de5f6d800e5e317398044cd16b85924)) ([`0097592`](https://github.com/taskforcesh/bullmq/commit/00975929ec559594bafb8fa1c4c7e75f87db912a))

### Unknown

* Merge pull request #103 from taskforcesh/fix-102-get-rid-of-flushdb-in-tests

fix: get rid of flushdb/flushall in tests ([`725ad01`](https://github.com/taskforcesh/bullmq/commit/725ad0179f615b9d53d939619210d26d8a5ec4a0))

* Merge branch &#39;master&#39; into fix-102-get-rid-of-flushdb-in-tests ([`d82748a`](https://github.com/taskforcesh/bullmq/commit/d82748a79f65c68b7427863a074b05cbce79a000))


## v1.6.4 (2020-01-05)

### Chore

* chore(release): 1.6.4 [skip ci]nn## [1.6.4](https://github.com/taskforcesh/bullmq/compare/v1.6.3...v1.6.4) (2020-01-05)

### Bug Fixes

* delete logs when cleaning jobs in set ([b11c6c7](https://github.com/taskforcesh/bullmq/commit/b11c6c7c9f4f1c49eac93b98fdc93ac8f861c8b2)) ([`d3b0ab0`](https://github.com/taskforcesh/bullmq/commit/d3b0ab09b5aeb3bc88b42f9e38efab0724dfa08f))

### Fix

* fix: get rid of flushdb/flushall in tests ([`550c67b`](https://github.com/taskforcesh/bullmq/commit/550c67b25de5f6d800e5e317398044cd16b85924))

* fix: remove duplicate active entry ([`1d2cca3`](https://github.com/taskforcesh/bullmq/commit/1d2cca38ee61289adcee4899a91f7dcbc93a7c05))

* fix: delete logs when cleaning jobs in set ([`b11c6c7`](https://github.com/taskforcesh/bullmq/commit/b11c6c7c9f4f1c49eac93b98fdc93ac8f861c8b2))

### Unknown

* Merge pull request #98 from taskforcesh/fix/delete-jobs-when-cleaning-in-set

Fix/delete jobs when cleaning in set ([`ab8d860`](https://github.com/taskforcesh/bullmq/commit/ab8d860c8f16867a2a46c620da742db43944d0a7))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq into fix/fix-tslib-dep ([`ba2db3a`](https://github.com/taskforcesh/bullmq/commit/ba2db3a0817de1cca54384531ba41e2616ff463d))


## v1.6.3 (2020-01-01)

### Chore

* chore(release): 1.6.3 [skip ci]nn## [1.6.3](https://github.com/taskforcesh/bullmq/compare/v1.6.2...v1.6.3) (2020-01-01)

### Bug Fixes

* add tslib dependency fixes [#65](https://github.com/taskforcesh/bullmq/issues/65) ([7ad7995](https://github.com/taskforcesh/bullmq/commit/7ad799544a9c30b30aa96df8864119159c9a1185)) ([`e4c47ae`](https://github.com/taskforcesh/bullmq/commit/e4c47aefb16df401e0a8a84981e2cce233a550ec))

* chore: import lodash es6 style ([`17c7378`](https://github.com/taskforcesh/bullmq/commit/17c73782420dc36e7b1108f596d2ac233ba97dd5))

### Fix

* fix: add tslib dependency fixes #65 ([`7ad7995`](https://github.com/taskforcesh/bullmq/commit/7ad799544a9c30b30aa96df8864119159c9a1185))

### Unknown

* Merge pull request #96 from taskforcesh/fix/fix-tslib-dep

Fix/fix tslib dep ([`f84cd9b`](https://github.com/taskforcesh/bullmq/commit/f84cd9bc875fedad25bd387e382ebb2ab4751e57))

* Merge branch &#39;master&#39; into fix/fix-tslib-dep ([`01818b9`](https://github.com/taskforcesh/bullmq/commit/01818b90ebd00cb9695b5d763a21cc1c76c445a3))

* Merge pull request #93 from ericcarboni/patch-1

docs: fix typo ([`d8bf244`](https://github.com/taskforcesh/bullmq/commit/d8bf244fbbb43b1975e89434c546e7bdabf91702))

* Merge branch &#39;master&#39; into patch-1 ([`5fcf40b`](https://github.com/taskforcesh/bullmq/commit/5fcf40b2aa91bbee022d727919d3cbdf75d3a118))


## v1.6.2 (2019-12-16)

### Chore

* chore(release): 1.6.2 [skip ci]nn## [1.6.2](https://github.com/taskforcesh/bullmq/compare/v1.6.1...v1.6.2) (2019-12-16)

### Bug Fixes

* change default QueueEvents lastEventId to $ ([3c5b01d](https://github.com/taskforcesh/bullmq/commit/3c5b01d16ee1442f5802a0fe4e7675c14f7a7f1f))
* ensure QE ready before adding test events ([fd190f4](https://github.com/taskforcesh/bullmq/commit/fd190f4be792b03273481c8aaf73be5ca42663d1))
* explicitly test the behavior of .on and .once ([ea11087](https://github.com/taskforcesh/bullmq/commit/ea11087b292d9325105707b53f92ac61c334a147)) ([`9b4042d`](https://github.com/taskforcesh/bullmq/commit/9b4042da2977178d007cb4f07686be897172792b))

### Unknown

* Merge pull request #82 from jbr/dollarsign-as-default-queue-event-id

$ as default queue event id #76 ([`7a6b2ee`](https://github.com/taskforcesh/bullmq/commit/7a6b2ee593d76718f45075556e6e7eb53251ca52))

* Merge branch &#39;master&#39; into patch-1 ([`176bd9d`](https://github.com/taskforcesh/bullmq/commit/176bd9d9a3d07fb8c2b74d055fcb36c541602590))

* Merge branch &#39;master&#39; into dollarsign-as-default-queue-event-id ([`878fc0d`](https://github.com/taskforcesh/bullmq/commit/878fc0d191a1d0ad16f41dad7d09ebbf26f6b493))


## v1.6.1 (2019-12-16)

### Chore

* chore(release): 1.6.1 [skip ci]nn## [1.6.1](https://github.com/taskforcesh/bullmq/compare/v1.6.0...v1.6.1) (2019-12-16)

### Bug Fixes

* check of existing redis instance ([dd466b3](https://github.com/taskforcesh/bullmq/commit/dd466b332b03b430108126531d59ff9e66ce9521)) ([`5410d23`](https://github.com/taskforcesh/bullmq/commit/5410d23b2cf7d19bf14c4c089874b9630237fa42))

* chore(deps): bump npm from 6.12.0 to 6.13.4

Bumps [npm](https://github.com/npm/cli) from 6.12.0 to 6.13.4.
- [Release notes](https://github.com/npm/cli/releases)
- [Changelog](https://github.com/npm/cli/blob/latest/CHANGELOG.md)
- [Commits](https://github.com/npm/cli/compare/v6.12.0...v6.13.4)

Signed-off-by: dependabot[bot] &lt;support@github.com&gt; ([`4780be2`](https://github.com/taskforcesh/bullmq/commit/4780be24fe8233f778fbb871bef2cafe9a0c37fe))

### Documentation

* docs: fix typo ([`307bb69`](https://github.com/taskforcesh/bullmq/commit/307bb695b98ea6094f1e2361d9019d298773c724))

### Fix

* fix: check of existing redis instance ([`dd466b3`](https://github.com/taskforcesh/bullmq/commit/dd466b332b03b430108126531d59ff9e66ce9521))

### Unknown

* Merge branch &#39;master&#39; into dollarsign-as-default-queue-event-id ([`3930d5a`](https://github.com/taskforcesh/bullmq/commit/3930d5a1c24396463afaefadb09e8292038c093c))

* Merge pull request #91 from Embraser01/fix-#90

fix: check of existing redis instance ([`6ebae9e`](https://github.com/taskforcesh/bullmq/commit/6ebae9e111d27f423e7736776735c750ed475c20))

* Merge branch &#39;master&#39; into dollarsign-as-default-queue-event-id ([`2727cb9`](https://github.com/taskforcesh/bullmq/commit/2727cb964d843f2a8533807f527518e8cecf2f70))

* Merge branch &#39;master&#39; into patch-1 ([`182087b`](https://github.com/taskforcesh/bullmq/commit/182087ba393caca72df9a0300d4195531079444f))

* Merge branch &#39;master&#39; into fix-#90 ([`b3b89b6`](https://github.com/taskforcesh/bullmq/commit/b3b89b6e74a86e1dfb6dd710a5fd8ae5ec77b044))

* Merge pull request #92 from taskforcesh/dependabot/npm_and_yarn/npm-6.13.4

chore(deps): bump npm from 6.12.0 to 6.13.4 ([`763ca72`](https://github.com/taskforcesh/bullmq/commit/763ca72f0a9ca866deea99648a5161b1aedd7998))

* Merge branch &#39;master&#39; into dollarsign-as-default-queue-event-id ([`e862de3`](https://github.com/taskforcesh/bullmq/commit/e862de317ecf4a04fbb10c0aeeda8afdd6b4903a))


## v1.6.0 (2019-12-12)

### Chore

* chore(release): 1.6.0 [skip ci]nn# [1.6.0](https://github.com/taskforcesh/bullmq/compare/v1.5.0...v1.6.0) (2019-12-12)

### Features

* add generic type to job data and return value ([87c0531](https://github.com/taskforcesh/bullmq/commit/87c0531efc2716db37f8a0886848cdb786709554)) ([`fd5e524`](https://github.com/taskforcesh/bullmq/commit/fd5e524d7435df6ad0c1c805b9ed56293fc39101))

* chore: fix typo ([`e73355a`](https://github.com/taskforcesh/bullmq/commit/e73355ac80d45bdc635e2d7965b29a102be0c976))

### Documentation

* docs: add github link to what-is-bullmq.md (#80) ([`4adf856`](https://github.com/taskforcesh/bullmq/commit/4adf85680028bafe2f7f1ac7a350f2d83a3fb58f))

### Feature

* feat: add generic type to job data and return value ([`87c0531`](https://github.com/taskforcesh/bullmq/commit/87c0531efc2716db37f8a0886848cdb786709554))

### Fix

* fix: explicitly test the behavior of .on and .once ([`ea11087`](https://github.com/taskforcesh/bullmq/commit/ea11087b292d9325105707b53f92ac61c334a147))

* fix: ensure QE ready before adding test events ([`fd190f4`](https://github.com/taskforcesh/bullmq/commit/fd190f4be792b03273481c8aaf73be5ca42663d1))

* fix: change default QueueEvents lastEventId to $ ([`3c5b01d`](https://github.com/taskforcesh/bullmq/commit/3c5b01d16ee1442f5802a0fe4e7675c14f7a7f1f))

### Test

* test: fix broken test ([`5a4acd7`](https://github.com/taskforcesh/bullmq/commit/5a4acd72442dc4d58a6da1bb2bc9fa673a62816a))

### Unknown

* Merge pull request #88 from taskforcesh/feat/add-generic-type-to-job-data

feat: add generic type to job data and return value ([`3f9eaec`](https://github.com/taskforcesh/bullmq/commit/3f9eaeceef002e13bf9d995256282c0bb0863cd1))

* Merge branch &#39;master&#39; into feat/add-generic-type-to-job-data ([`d31ab9b`](https://github.com/taskforcesh/bullmq/commit/d31ab9b9204c8f20447c4392518481653b017149))

* Merge pull request #78 from ericcarboni/patch-1

Docs: update quick start page ([`36604f5`](https://github.com/taskforcesh/bullmq/commit/36604f5c53d5984e48170ebb937dd9d2fc7c1875))

* Update README.md ([`762f7e6`](https://github.com/taskforcesh/bullmq/commit/762f7e60f0577560b6e1ce1545b88e01d96d62b3))


## v1.5.0 (2019-11-22)

### Chore

* chore(release): 1.5.0 [skip ci]nn# [1.5.0](https://github.com/taskforcesh/bullmq/compare/v1.4.3...v1.5.0) (2019-11-22)

### Features

* remove delay dependency ([97e1a30](https://github.com/taskforcesh/bullmq/commit/97e1a3015d853e615ddd623af07f12a194ccab2c))
* remove dependence on Bluebird.delay [#67](https://github.com/taskforcesh/bullmq/issues/67) ([bedbaf2](https://github.com/taskforcesh/bullmq/commit/bedbaf25af6479e387cd7548e246dca7c72fc140)) ([`e8e37cf`](https://github.com/taskforcesh/bullmq/commit/e8e37cf2da26d1f67f21e3bd94da65025e7bde8f))

### Feature

* feat: remove delay dependency

this commit uses delay from utils in typescript and adds a simple
test/fixtures/delay.js for use in javascript fixtures. this change also
allowed the ts compiler to identify a promise that was not `await`ed in
src/test/test_worker.ts ([`97e1a30`](https://github.com/taskforcesh/bullmq/commit/97e1a3015d853e615ddd623af07f12a194ccab2c))

* feat: remove dependence on Bluebird.delay #67

This approach uses a simple setTimeout-based delay in the only production
usage (src/classes/queue-events.ts), defined in src/util.ts, and since
there was already a devDependency on a library called
[delay](https://www.npmjs.com/package/delay), this commit uses that in
test contexts. It should be easy to replace that dep with a
`(ms:number) =&gt; new Promise(r =&gt; setTimeout(r, ms))` as well.

Closes #67 ([`bedbaf2`](https://github.com/taskforcesh/bullmq/commit/bedbaf25af6479e387cd7548e246dca7c72fc140))

### Unknown

* Merge pull request #75 from jbr/feat-67-remove-bluebird-dependency

feat: remove dependence on Bluebird and delay #67 ([`8d38bfa`](https://github.com/taskforcesh/bullmq/commit/8d38bfa77d1c1249ec9f95a754327491ef001e28))


## v1.4.3 (2019-11-21)

### Chore

* chore(release): 1.4.3 [skip ci]nn## [1.4.3](https://github.com/taskforcesh/bullmq/compare/v1.4.2...v1.4.3) (2019-11-21)

### Bug Fixes

* check in moveToFinished to use default val for opts.maxLenEvents ([d1118aa](https://github.com/taskforcesh/bullmq/commit/d1118aab77f755b4a65e3dd8ea2e195baf3d2602)) ([`136f087`](https://github.com/taskforcesh/bullmq/commit/136f0879bb28d4b6c2e860f11fc6d65446ac6900))

### Unknown

* Merge pull request #73 from taskforcesh/fix-72-default-maxLenEvents-in-move-to-finished-lua

fix: check in moveToFinished to use default val for opts.maxLenEvents ([`f79e5ad`](https://github.com/taskforcesh/bullmq/commit/f79e5ad83398bd858dd082f7b12639a9f38e7f49))

* Merge branch &#39;master&#39; into fix-72-default-maxLenEvents-in-move-to-finished-lua ([`5cbc742`](https://github.com/taskforcesh/bullmq/commit/5cbc742f9ee8420a4bf06d22080ba58572752a13))


## v1.4.2 (2019-11-21)

### Chore

* chore(release): 1.4.2 [skip ci]nn## [1.4.2](https://github.com/taskforcesh/bullmq/compare/v1.4.1...v1.4.2) (2019-11-21)

### Bug Fixes

* avoid Job&lt;-&gt;Queue circular json error ([5752727](https://github.com/taskforcesh/bullmq/commit/5752727a6294e1b8d35f6a49e4953375510e10e6))
* avoid the .toJSON serializer interface [#70](https://github.com/taskforcesh/bullmq/issues/70) ([5941b82](https://github.com/taskforcesh/bullmq/commit/5941b82b646e46d53970197a404e5ea54f09d008)) ([`371ef07`](https://github.com/taskforcesh/bullmq/commit/371ef07fbb61c5ad490061c9571dbd8df9f6ab47))

### Fix

* fix: avoid Job&lt;-&gt;Queue circular json error ([`5752727`](https://github.com/taskforcesh/bullmq/commit/5752727a6294e1b8d35f6a49e4953375510e10e6))

* fix: avoid the .toJSON serializer interface #70

renames Job#toJSON to Job#asJSON and adds a test ([`5941b82`](https://github.com/taskforcesh/bullmq/commit/5941b82b646e46d53970197a404e5ea54f09d008))

* fix: check in moveToFinished to use default val for opts.maxLenEvents ([`d1118aa`](https://github.com/taskforcesh/bullmq/commit/d1118aab77f755b4a65e3dd8ea2e195baf3d2602))

### Unknown

* Merge pull request #74 from jbr/fix-70-job-tojson

fix: avoid changing Job property types through JSON serialization/deserialization #70 ([`344a887`](https://github.com/taskforcesh/bullmq/commit/344a887e924048d7a2ab2036b6adfcdd99a6f466))


## v1.4.1 (2019-11-08)

### Chore

* chore(release): 1.4.1 [skip ci]nn## [1.4.1](https://github.com/taskforcesh/bullmq/compare/v1.4.0...v1.4.1) (2019-11-08)

### Bug Fixes

* default job settings [#58](https://github.com/taskforcesh/bullmq/issues/58) ([667fc6e](https://github.com/taskforcesh/bullmq/commit/667fc6e00ae4d6da639d285a104fb67e01c95bbd)) ([`ad1fc3c`](https://github.com/taskforcesh/bullmq/commit/ad1fc3c19d5c02382989a7e1cb72b807b743465c))

### Unknown

* Merge pull request #58 from HNicolas/patch-1

Fix #57 ([`f67d306`](https://github.com/taskforcesh/bullmq/commit/f67d3063f2296325e2d753600dbf633960034195))

* Merge branch &#39;master&#39; into patch-1 ([`c41b4f3`](https://github.com/taskforcesh/bullmq/commit/c41b4f329dd21874c6a2bf7b2a649c956fd0a3da))

* GitBook: [master] 4 pages modified ([`fde089d`](https://github.com/taskforcesh/bullmq/commit/fde089d85397ad48a382e3c1eb0fac835a9f49ad))

* Merge branch &#39;master&#39; into patch-1 ([`cabed12`](https://github.com/taskforcesh/bullmq/commit/cabed126f7d699e1335be78007221987000146cd))


## v1.4.0 (2019-11-06)

### Chore

* chore(release): 1.4.0 [skip ci]nn# [1.4.0](https://github.com/taskforcesh/bullmq/compare/v1.3.0...v1.4.0) (2019-11-06)

### Features

* job.progress() return last progress for sandboxed processors ([5c4b146](https://github.com/taskforcesh/bullmq/commit/5c4b146ca8e42c8a29f9db87326a17deac30e10e)) ([`5e9e0b3`](https://github.com/taskforcesh/bullmq/commit/5e9e0b33cd548952a6968151db94325f299ae3c4))

### Unknown

* Merge branch &#39;master&#39; into patch-1 ([`f964575`](https://github.com/taskforcesh/bullmq/commit/f964575510ed246bee14d2edb5c1aa61423d0e10))

* Merge pull request #60 from taskforcesh/feat-job-progress-getter-for-sanboxed-processors

job.progress() return last progress for sandboxed processors ([`11bfae6`](https://github.com/taskforcesh/bullmq/commit/11bfae63ac64bfa24df1e51ff5343447863e0095))

* Merge branch &#39;master&#39; into feat-job-progress-getter-for-sanboxed-processors ([`302bf9c`](https://github.com/taskforcesh/bullmq/commit/302bf9cb30aafb8f3e3d8abe9bbd2904661c3340))


## v1.3.0 (2019-11-05)

### Chore

* chore(release): 1.3.0 [skip ci]nn# [1.3.0](https://github.com/taskforcesh/bullmq/compare/v1.2.0...v1.3.0) (2019-11-05)

### Features

* test worker extends job lock while job is active ([577efdf](https://github.com/taskforcesh/bullmq/commit/577efdfb1d2d3140be78dee3bd658b5ce969b16d)) ([`c6b1e65`](https://github.com/taskforcesh/bullmq/commit/c6b1e65b424f0feb700468564276786895acec70))

### Feature

* feat: test worker extends job lock while job is active ([`577efdf`](https://github.com/taskforcesh/bullmq/commit/577efdfb1d2d3140be78dee3bd658b5ce969b16d))

* feat: job.progress() return last progress for sandboxed processors

ported from Bull3 (https://github.com/OptimalBits/bull/pull/1536) ([`5c4b146`](https://github.com/taskforcesh/bullmq/commit/5c4b146ca8e42c8a29f9db87326a17deac30e10e))

### Fix

* fix: default job settings #58

I updated job options merging in order to override default job options when options are provided at job level.
Maybe a deep merge between the two objects could be even better. ([`667fc6e`](https://github.com/taskforcesh/bullmq/commit/667fc6e00ae4d6da639d285a104fb67e01c95bbd))

### Unknown

* Merge branch &#39;master&#39; into feat-job-progress-getter-for-sanboxed-processors ([`5211dd7`](https://github.com/taskforcesh/bullmq/commit/5211dd7258396266bc41bd6ecb530e4c3042f5c8))

* Merge pull request #61 from taskforcesh/feat-test-worker-extends-job-lock

Test worker extends job lock while job is active ([`0cf504f`](https://github.com/taskforcesh/bullmq/commit/0cf504f5fca2240e5e27eb95475d2f221bf3bfc9))


## v1.2.0 (2019-11-03)

### Chore

* chore(release): 1.2.0 [skip ci]nn# [1.2.0](https://github.com/taskforcesh/bullmq/compare/v1.1.0...v1.2.0) (2019-11-03)

### Bug Fixes

* only run coveralls after success ([bd51893](https://github.com/taskforcesh/bullmq/commit/bd51893c35793657b65246a2f5a06469488c8a06))

### Features

* added code coverage and coveralls ([298cfc4](https://github.com/taskforcesh/bullmq/commit/298cfc48e35e648e6a22ac0d1633ac16c7b6e3de))
* added missing deps for coverage ([6f3ab8d](https://github.com/taskforcesh/bullmq/commit/6f3ab8d78ba8503a76447f0db5abf0c1c4f8e185))
* ignore commitlint file in coverage ([f874441](https://github.com/taskforcesh/bullmq/commit/f8744411a1b20b95e568502be15ec50cf8520926))
* only upload coverage once after all tests pass ([a7f73ec](https://github.com/taskforcesh/bullmq/commit/a7f73ecc2f51544f1d810de046ba073cb7aa5663)) ([`89bb554`](https://github.com/taskforcesh/bullmq/commit/89bb554b3e8dcc7f8e2376f1a4557ef3d8e0c96f))

### Feature

* feat: only upload coverage once after all tests pass ([`a7f73ec`](https://github.com/taskforcesh/bullmq/commit/a7f73ecc2f51544f1d810de046ba073cb7aa5663))

* feat: ignore commitlint file in coverage ([`f874441`](https://github.com/taskforcesh/bullmq/commit/f8744411a1b20b95e568502be15ec50cf8520926))

* feat: added missing deps for coverage ([`6f3ab8d`](https://github.com/taskforcesh/bullmq/commit/6f3ab8d78ba8503a76447f0db5abf0c1c4f8e185))

* feat: added code coverage and coveralls ([`298cfc4`](https://github.com/taskforcesh/bullmq/commit/298cfc48e35e648e6a22ac0d1633ac16c7b6e3de))

### Fix

* fix: only run coveralls after success ([`bd51893`](https://github.com/taskforcesh/bullmq/commit/bd51893c35793657b65246a2f5a06469488c8a06))

### Unknown

* Merge pull request #55 from MichielDeMey/feature/coveralls

Feat/coveralls Adds code coverage with Coveralls integration ([`4deb7d4`](https://github.com/taskforcesh/bullmq/commit/4deb7d43db5ee459cb8536e5202d2e4bb3811af3))


## v1.1.0 (2019-11-01)

### Chore

* chore(release): 1.1.0 [skip ci]nn# [1.1.0](https://github.com/taskforcesh/bullmq/compare/v1.0.1...v1.1.0) (2019-11-01)

### Bug Fixes

* failing build ([bb21d53](https://github.com/taskforcesh/bullmq/commit/bb21d53b199885dcc97e7fe20f60caf65e55e782))
* fix failing tests ([824eb6b](https://github.com/taskforcesh/bullmq/commit/824eb6bfb2b750b823d057c894797ccb336245d8))

### Features

* initial version of job locking mechanism ([1d4fa38](https://github.com/taskforcesh/bullmq/commit/1d4fa383e39f4f5dcb69a71a1359dd5dea75544c)) ([`1f55fa2`](https://github.com/taskforcesh/bullmq/commit/1f55fa26be8834ac970a219485e3c5c681390b75))

### Fix

* fix: failing build ([`bb21d53`](https://github.com/taskforcesh/bullmq/commit/bb21d53b199885dcc97e7fe20f60caf65e55e782))

* fix: fix failing tests ([`824eb6b`](https://github.com/taskforcesh/bullmq/commit/824eb6bfb2b750b823d057c894797ccb336245d8))

### Unknown

* Merge pull request #52 from taskforcesh/feat-47-job-locking

Job locking mechanism ([`dd502b2`](https://github.com/taskforcesh/bullmq/commit/dd502b21952cba180f419a542c319414372177b1))

* Merge branch &#39;feat-47-job-locking&#39; of https://github.com/taskforcesh/bullmq into feat-47-job-locking ([`5e0d4f7`](https://github.com/taskforcesh/bullmq/commit/5e0d4f77cef174fcbac8ecf1423d4fbf3938ad2a))

* Merge branch &#39;master&#39; into feat-47-job-locking ([`8464697`](https://github.com/taskforcesh/bullmq/commit/8464697d1d1ccfd40d851ebe12226a8eb75c28b8))

* Merge pull request #54 from root-io/patch-1

doc: use correct connection property ([`f3336de`](https://github.com/taskforcesh/bullmq/commit/f3336de43567e859905795517e5bf1aa4936e60d))

* Merge branch &#39;master&#39; into patch-1 ([`d311fc4`](https://github.com/taskforcesh/bullmq/commit/d311fc420a85718cf77fe4103d923a34efadbc63))

* Merge branch &#39;master&#39; into feat-47-job-locking ([`d4509b9`](https://github.com/taskforcesh/bullmq/commit/d4509b95498be24d32f815e08b2aabc4cea14ed2))

* GitBook: [master] one page modified ([`93bfbd0`](https://github.com/taskforcesh/bullmq/commit/93bfbd0395f2c69193476b93ff5ad26f1933a7ca))

* doc: use correct connection property ([`3a1ef5e`](https://github.com/taskforcesh/bullmq/commit/3a1ef5e2aafe169b212a13d63cc2f7687ace89d9))

* Merge branch &#39;master&#39; into feat-47-job-locking ([`4bab512`](https://github.com/taskforcesh/bullmq/commit/4bab512fda82fccdbda5d7896560e3b163e154c5))


## v1.0.1 (2019-10-27)

### Chore

* chore(release): 1.0.1 [skip ci]nn## [1.0.1](https://github.com/taskforcesh/bullmq/compare/v1.0.0...v1.0.1) (2019-10-27)

### Bug Fixes

* save job stacktrace on failure ([85dfe52](https://github.com/taskforcesh/bullmq/commit/85dfe525079a5f89c1901dbf35c7ddc6663afc24))
* simplify logic for stackTraceLimit ([296bd89](https://github.com/taskforcesh/bullmq/commit/296bd89514d430a499afee934dcae2aec41cffa2)) ([`72f3669`](https://github.com/taskforcesh/bullmq/commit/72f36694139163009bc237a9ee25ea0070946dfb))

* chore: enabled npm publish ([`cd3dc46`](https://github.com/taskforcesh/bullmq/commit/cd3dc46b6cfc5a403a5bbe36519f471fb4128fe5))

### Feature

* feat: initial version of job locking mechanism ([`1d4fa38`](https://github.com/taskforcesh/bullmq/commit/1d4fa383e39f4f5dcb69a71a1359dd5dea75544c))

### Fix

* fix: simplify logic for stackTraceLimit ([`296bd89`](https://github.com/taskforcesh/bullmq/commit/296bd89514d430a499afee934dcae2aec41cffa2))

* fix: save job stacktrace on failure ([`85dfe52`](https://github.com/taskforcesh/bullmq/commit/85dfe525079a5f89c1901dbf35c7ddc6663afc24))

### Unknown

* Merge pull request #51 from taskforcesh/fix-31-stacktrace-missing-after-job-failure

Save job stacktrace on failure ([`855560a`](https://github.com/taskforcesh/bullmq/commit/855560a675dd40cc9d51bcc2bcad70bc3c44373d))

* Merge branch &#39;master&#39; into fix-31-stacktrace-missing-after-job-failure ([`42f671a`](https://github.com/taskforcesh/bullmq/commit/42f671af17a4680b1168100ec60fb9921b624acf))

* Merge branch &#39;master&#39; into feat-47-job-locking ([`e0444e3`](https://github.com/taskforcesh/bullmq/commit/e0444e396fb73fa911cfd02d5689b4dad41c807e))

* Merge pull request #39 from taskforcesh/fix-cleanup-dependencies

Replace deprecated node-uuid with uuid, move lodash to runtime dependencies ([`3a3a21b`](https://github.com/taskforcesh/bullmq/commit/3a3a21b3da21485c7ff73ee7e297b14ec9f01bab))

* Merge branch &#39;master&#39; into fix-cleanup-dependencies ([`13a8aff`](https://github.com/taskforcesh/bullmq/commit/13a8affa7435a4e7132d7e44394633e62350b935))


## v1.0.0 (2019-10-20)

### Chore

* chore(release): 1.0.0 [skip ci]nn# 1.0.0 (2019-10-20)

### Bug Fixes

* add compilation step before running tests ([64abc13](https://github.com/taskforcesh/bullmq/commit/64abc13681f8735fb3ee5add5b271bb4da618047))
* add extra client to worker fixes [#34](https://github.com/taskforcesh/bullmq/issues/34) ([90bd891](https://github.com/taskforcesh/bullmq/commit/90bd891c7514f5e9e397d7aad15069ee55bebacd))
* add missing dependency ([b92e330](https://github.com/taskforcesh/bullmq/commit/b92e330aad35ae54f43376f92ad1b41209012b76))
* check closing after resuming from pause ([7b2cef3](https://github.com/taskforcesh/bullmq/commit/7b2cef3677e2b3af0370e0023aec4b971ad313fe))
* default opts ([333c73b](https://github.com/taskforcesh/bullmq/commit/333c73b5819a263ae92bdb54f0406c19db5cb64f))
* do not block if blockTime is zero ([13b2df2](https://github.com/taskforcesh/bullmq/commit/13b2df20cf045c069b8b581751e117722681dcd4))
* do not exec if closing ([b1d1c08](https://github.com/taskforcesh/bullmq/commit/b1d1c08a2948088eeb3dd65de78085329bac671b))
* do not trim if maxEvents is undefined ([7edd8f4](https://github.com/taskforcesh/bullmq/commit/7edd8f47b392c8b3a7369196befdafa4b29421d1))
* emit wait event in add job ([39cba31](https://github.com/taskforcesh/bullmq/commit/39cba31a30b7ef762a8d55d4bc34efec636207bf))
* fix a couple of job tests ([e66b97b](https://github.com/taskforcesh/bullmq/commit/e66b97be4577d5ab373fff0f3f45d73de7842a37))
* fix compiling error ([3cf2617](https://github.com/taskforcesh/bullmq/commit/3cf261703292d263d1e2017ae30eb490121dab4e))
* fix more tests ([6a07b35](https://github.com/taskforcesh/bullmq/commit/6a07b3518f856e8f7158be032110c925ed5c924f))
* fix progress script ([4228e27](https://github.com/taskforcesh/bullmq/commit/4228e2768c0cf404e09642ebb4053147d0badb56))
* fix retry functionality ([ec41ea4](https://github.com/taskforcesh/bullmq/commit/ec41ea4e0bd88b10b1ba434ef5ceb0952bb59f7b))
* fix several floating promises ([590a4a9](https://github.com/taskforcesh/bullmq/commit/590a4a925167a7c7d6c0d9764bbb5ab69235beb7))
* fixed reprocess lua script ([b78296f](https://github.com/taskforcesh/bullmq/commit/b78296f33517b8c5d79b300fef920edd03149d2f))
* improve concurrency mechanism ([a3f6148](https://github.com/taskforcesh/bullmq/commit/a3f61489e3c9891f42749ff85bd41064943c62dc))
* improve disconnection for queue events ([56b53a1](https://github.com/taskforcesh/bullmq/commit/56b53a1aca1e527b50f04d906653060fe8ca644e))
* initialize events comsumption in constructor ([dbb66cd](https://github.com/taskforcesh/bullmq/commit/dbb66cda9722d44eca806fa6ad1cabdaabac846a))
* make ioredis typings a normal dependency ([fb80b90](https://github.com/taskforcesh/bullmq/commit/fb80b90b12931a12a1a93c5e204dbf90eed4f48f))
* minor fixes ([7791cda](https://github.com/taskforcesh/bullmq/commit/7791cdac2bfb6a7fbbab9c95c5d89b1eae226a4c))
* parse progres and return value in events ([9e43d0e](https://github.com/taskforcesh/bullmq/commit/9e43d0e30ab90a290942418718cde1f5bfbdcf56))
* properly emit event for progress ([3f70175](https://github.com/taskforcesh/bullmq/commit/3f701750b1c957027825ee90b58141cd2556694f))
* reduce drain delay to 5 seconds ([c6cfe7c](https://github.com/taskforcesh/bullmq/commit/c6cfe7c0b50cabe5e5eb31f4b631a8b1d3706611))
* remove buggy close() on redis-connection (fixes 5 failing tests) ([64c2ede](https://github.com/taskforcesh/bullmq/commit/64c2edec5e738f43676d0f4ca61bdea8609203fc))
* remove unused dependencies ([34293c8](https://github.com/taskforcesh/bullmq/commit/34293c84bb0ed54f18d70c86821c3ac627d376a5))
* replace init by waitUntilReady ([4336161](https://github.com/taskforcesh/bullmq/commit/43361610de5b1a993a1c65f3f21ac745b8face21))
* reworked initialization of redis clients ([c17d4be](https://github.com/taskforcesh/bullmq/commit/c17d4be5a2ecdda3efcdc6b9d7aecdfaccd06d83))
* several fixes to make the lib work on other ts projects ([3cac1b0](https://github.com/taskforcesh/bullmq/commit/3cac1b0715613d9df51cb1ed6fe0859bcfbb8e9b))
* throw error messages instead of codes ([9267541](https://github.com/taskforcesh/bullmq/commit/92675413f1c3b9564574dc264ffcab0d6089e70e))
* update tests after merge ([51f75a4](https://github.com/taskforcesh/bullmq/commit/51f75a4929e7ae2704e42fa9035e335fe60d8dc0))
* wait until ready before trying to get jobs ([f3b768f](https://github.com/taskforcesh/bullmq/commit/f3b768f251ddafa207466af552376065b35bec8f))
* **connections:** reused connections ([1e808d2](https://github.com/taskforcesh/bullmq/commit/1e808d24018a29f6611f4fccd2f5754de0fa3e39))
* waitUntilFinished improvements ([18d4afe](https://github.com/taskforcesh/bullmq/commit/18d4afef08f04d19cb8d931e02fff8f962d07ee7))

### Features

* add cleaned event ([c544775](https://github.com/taskforcesh/bullmq/commit/c544775803626b5f03cf6f7c3cf18ed1d92debab))
* add empty method ([4376112](https://github.com/taskforcesh/bullmq/commit/4376112369d869c0a5c7ab4a543cfc50200e1414))
* add retry errors ([f6a7990](https://github.com/taskforcesh/bullmq/commit/f6a7990fb74585985729c5d95e2238acde6cf74a))
* add script to generate typedocs ([d0a8cb3](https://github.com/taskforcesh/bullmq/commit/d0a8cb32ef9090652017f8fbf2ca42f0960687f7))
* add some new tests for compat class, more minor fixes ([bc0f653](https://github.com/taskforcesh/bullmq/commit/bc0f653ecf7aedd5a46eee6f912ecd6849395dca))
* add support for adding jobs in bulk ([b62bddc](https://github.com/taskforcesh/bullmq/commit/b62bddc054b266a809b4b1646558a095a276d6d1))
* add trimEvents method to queue client ([b7da7c4](https://github.com/taskforcesh/bullmq/commit/b7da7c4de2de81282aa41f8b7624b9030edf7d15))
* automatically trim events ([279bbba](https://github.com/taskforcesh/bullmq/commit/279bbbab7e96ad8676ed3bd68663cb199067ea67))
* emit global stalled event fixes [#10](https://github.com/taskforcesh/bullmq/issues/10) ([241f229](https://github.com/taskforcesh/bullmq/commit/241f229761691b9ac17124da005f91594a78273d))
* get rid of Job3 in favor of bullmq Job class ([7590cea](https://github.com/taskforcesh/bullmq/commit/7590ceae7abe32a8824e4a265f95fef2f9a6665f))
* implement close in redis connection fixes [#8](https://github.com/taskforcesh/bullmq/issues/8) ([6de8b48](https://github.com/taskforcesh/bullmq/commit/6de8b48c9612ea39bb28db5f4130cb2a2bb5ee90))
* make delay in backoffs optional ([30d59e5](https://github.com/taskforcesh/bullmq/commit/30d59e519794780a8198222d0bbd88779c623275))
* move async initialization to constructors ([3fbacd0](https://github.com/taskforcesh/bullmq/commit/3fbacd088bc3bfbd61ed8ff173e4401193ce48ec))
* port a lot of functionality from bull 3.x ([ec9f3d2](https://github.com/taskforcesh/bullmq/commit/ec9f3d266c1aca0c27cb600f056d813c81259b4c))
* port more features from bull 3.x ([75bd261](https://github.com/taskforcesh/bullmq/commit/75bd26158678ee45a14e04fd7c3a1f96219979a2))
* ported tests and functionality from bull 3 ([1b6b192](https://github.com/taskforcesh/bullmq/commit/1b6b1927c7e8e6b6f1bf0bbd6c74eb59cc17deb6))
* **workers:** support for async backoffs ([c555837](https://github.com/taskforcesh/bullmq/commit/c55583701e5bdd4e6436a61c833e506bc05749de))
* remove support of bull3 config format in compat class ([d909486](https://github.com/taskforcesh/bullmq/commit/d9094868e34c2af21f810aaef4542951a509ccf8))
* support global:progress event ([60f4d85](https://github.com/taskforcesh/bullmq/commit/60f4d85d332b3be4a80db7aa179f3a9ceeb1d6f8))
* trim option to event stream [#21](https://github.com/taskforcesh/bullmq/issues/21) &amp; fix [#17](https://github.com/taskforcesh/bullmq/issues/17) ([7eae653](https://github.com/taskforcesh/bullmq/commit/7eae65340820043101fadf1f87802f506020d553)) ([`e2e2d8d`](https://github.com/taskforcesh/bullmq/commit/e2e2d8d186c97a4762ce146887b7c3db6841a23e))

* chore: add missing dependency ([`10fd6f5`](https://github.com/taskforcesh/bullmq/commit/10fd6f5608140131000f0001c7ba7501ac56ade8))

* chore: add missing dependencies ([`b71ef0e`](https://github.com/taskforcesh/bullmq/commit/b71ef0e6bf9852253c1fb5fef51835dec7ba3a0b))

* chore: add semantic release plugins ([`58477ad`](https://github.com/taskforcesh/bullmq/commit/58477ad6c70dcb0772a89482ad52576899fac031))

* chore: replace deprecated node-uuid with uuid, move lodash to deps ([`4c13565`](https://github.com/taskforcesh/bullmq/commit/4c135653429188dac568ac4c749514e06f82562e))

* chore: cleanups ([`c682abd`](https://github.com/taskforcesh/bullmq/commit/c682abd5c7a1ff7bdc1df29bbc47782e15af2a52))

* chore: add prepublish script ([`29e37c5`](https://github.com/taskforcesh/bullmq/commit/29e37c5ed6741a39d193eaf18170caac68ab7251))

* chore: bump to 4.0.0-beta.1 ([`f644cb0`](https://github.com/taskforcesh/bullmq/commit/f644cb0ba3158fe672e1371369f42de70a546224))

* chore: update gitignore ([`83e8982`](https://github.com/taskforcesh/bullmq/commit/83e8982e132660c7a30cc63f5d93c7bd8638a13d))

* chore: ordered dependencies ([`c72226b`](https://github.com/taskforcesh/bullmq/commit/c72226bfda7cf736432f7c5f840065d87346702e))

* chore: merge upstream ([`e3564a7`](https://github.com/taskforcesh/bullmq/commit/e3564a7eb07a217015521ef31f2a1951305f1c0a))

* chore: refactor options fix #17 ([`c0016db`](https://github.com/taskforcesh/bullmq/commit/c0016db4f6a459d96c1362f75390a1c8f0d71f5c))

* chore: moved opts to local variable ([`ec07491`](https://github.com/taskforcesh/bullmq/commit/ec0749163f86d41374756c7c7e0673bf98e4bd48))

* chore: refactor opts ([`b060bf7`](https://github.com/taskforcesh/bullmq/commit/b060bf73ec9947050f131b4271339197ab74b9c8))

* chore: merge upstream ([`69bd8d1`](https://github.com/taskforcesh/bullmq/commit/69bd8d1f1baf45bd64cb23eec4913088407da110))

* chore: merge development-4.0 into feat-bull3-compat-api-v2 ([`e47cc87`](https://github.com/taskforcesh/bullmq/commit/e47cc87583aadbad11c01fee7384c0628add49b8))

* chore: rename append to add ([`6bbbdd2`](https://github.com/taskforcesh/bullmq/commit/6bbbdd281e733eccabf8262c0661daeb51f8afad))

* chore: remove empty method since it is a duplicate ([`bb518ae`](https://github.com/taskforcesh/bullmq/commit/bb518ae06ffcf025eb48416a5f8b3849bb2dcb24))

* chore: rename queue keeper to scheduler ([`b7a35a4`](https://github.com/taskforcesh/bullmq/commit/b7a35a452033262f887ffe713ae8f461978719f7))

* chore: rename to scheduler opts ([`91c1697`](https://github.com/taskforcesh/bullmq/commit/91c1697eb5d35dff223dcd8624be407bb4897bd4))

* chore: cleanup, rm unnecessary changes, apply changes requested in #3 ([`82d4c4e`](https://github.com/taskforcesh/bullmq/commit/82d4c4eae592a6921a3f8bb6251085404cc29491))

* chore: use await instead of then ([`85302c4`](https://github.com/taskforcesh/bullmq/commit/85302c467a42552573fcbe5cfc802459a001cf4e))

* chore: remove several logs and minor cosmetic fixes ([`bc022d5`](https://github.com/taskforcesh/bullmq/commit/bc022d57030de447bc98088808577050a8b89d21))

* chore: rename queue-keeper to queue-scheduler ([`ac76bb1`](https://github.com/taskforcesh/bullmq/commit/ac76bb19abe264993ba35501488240f4c22c570f))

* chore: remove outcommented code ([`23d8dcc`](https://github.com/taskforcesh/bullmq/commit/23d8dcce148ee05c57bda44e8c187f693239b777))

* chore: merge master ([`d8e6b1f`](https://github.com/taskforcesh/bullmq/commit/d8e6b1f5d2f3367afcc859f35f3790ac08dd1a82))

* chore: add scafolding ([`b0b2863`](https://github.com/taskforcesh/bullmq/commit/b0b286352f0f91348c4e1e892f5a75d79ca17aff))

### Ci

* ci: upgrade dependencies ([`5c0eb6f`](https://github.com/taskforcesh/bullmq/commit/5c0eb6f0970c92b5bc629bf2b13c08acbbdc7198))

* ci: upgrade dependencies ([`96d82ef`](https://github.com/taskforcesh/bullmq/commit/96d82ef45ab4c7cf9c821f8e39d0a1ff316cde91))

* ci: upgrade dependencies ([`34370df`](https://github.com/taskforcesh/bullmq/commit/34370df19c41edad96c1f39fc57462df8f75343b))

* ci: add test watch mode ([`7ff72a7`](https://github.com/taskforcesh/bullmq/commit/7ff72a7b5751d14fd43a31c747c8310413fe2ef7))

* ci: upgrade semver ([`e9ad1e4`](https://github.com/taskforcesh/bullmq/commit/e9ad1e4dfb590ea4a4d5ae94afb034bff7a76d3b))

* ci: remove package-lock.json ([`bb628b9`](https://github.com/taskforcesh/bullmq/commit/bb628b9f38077b89e73a0629cb2a5d893cf3486c))

* ci: add yarn.lock ([`2aab767`](https://github.com/taskforcesh/bullmq/commit/2aab7670405c6fe87a4c503e1381ca3dd12ef711))

* ci: add husky ([`a4b4eb8`](https://github.com/taskforcesh/bullmq/commit/a4b4eb84a5b12a8db6536c2999293419bf9000ed))

* ci: add commitling config ([`13025b4`](https://github.com/taskforcesh/bullmq/commit/13025b452e2e7b708d5453706e0ef2dd84469931))

* ci: ignore yarn.lock ([`e67a911`](https://github.com/taskforcesh/bullmq/commit/e67a911acd20023b6b3355987d0469302858e0cc))

* ci: deprecated node 6 &amp; added node 12 ([`75deb60`](https://github.com/taskforcesh/bullmq/commit/75deb60f491d454c99deddd0a6414069e10bdfcc))

* ci: add linter step to travis ([`33774fb`](https://github.com/taskforcesh/bullmq/commit/33774fb81fea305b5a23a4101b6ad03554582e07))

* ci: remove unnecessary &#34;--&#34; ([`30287d7`](https://github.com/taskforcesh/bullmq/commit/30287d7314976a4733957896aaffe90f1003b1cf))

* ci: remove yarn lock ([`9129a56`](https://github.com/taskforcesh/bullmq/commit/9129a56a1fc12ae1d06f9b9a1d357362bf505aac))

* ci: upgrade dependencies ([`5f07618`](https://github.com/taskforcesh/bullmq/commit/5f07618d5a4c7462a01f9bb4818e57b4a9340ee8))

### Documentation

* docs: add missing colon ([`c3a71f9`](https://github.com/taskforcesh/bullmq/commit/c3a71f993d3c1e8177b64f884910fb7c167ec9c4))

* docs: redirect changelog correctly ([`efb05ca`](https://github.com/taskforcesh/bullmq/commit/efb05ca431f79058297bad4ca994bf12d681b8fa))

* docs: move gitbook documentation ([`2d2d98f`](https://github.com/taskforcesh/bullmq/commit/2d2d98f2eba2bdf4cbe789a03ac18fa8893672f5))

* docs: updated README ([`06ae5cc`](https://github.com/taskforcesh/bullmq/commit/06ae5cc4fa654ba436fefed6aeaf533d498a004c))

### Feature

* feat: implement close in redis connection fixes #8 ([`6de8b48`](https://github.com/taskforcesh/bullmq/commit/6de8b48c9612ea39bb28db5f4130cb2a2bb5ee90))

* feat(workers): support for async backoffs ([`c555837`](https://github.com/taskforcesh/bullmq/commit/c55583701e5bdd4e6436a61c833e506bc05749de))

* feat: move async initialization to constructors ([`3fbacd0`](https://github.com/taskforcesh/bullmq/commit/3fbacd088bc3bfbd61ed8ff173e4401193ce48ec))

* feat: automatically trim events ([`279bbba`](https://github.com/taskforcesh/bullmq/commit/279bbbab7e96ad8676ed3bd68663cb199067ea67))

* feat: add trimEvents method to queue client ([`b7da7c4`](https://github.com/taskforcesh/bullmq/commit/b7da7c4de2de81282aa41f8b7624b9030edf7d15))

* feat: add script to generate typedocs ([`d0a8cb3`](https://github.com/taskforcesh/bullmq/commit/d0a8cb32ef9090652017f8fbf2ca42f0960687f7))

* feat: emit global stalled event fixes #10 ([`241f229`](https://github.com/taskforcesh/bullmq/commit/241f229761691b9ac17124da005f91594a78273d))

* feat: trim option to event stream #21 &amp; fix #17 ([`7eae653`](https://github.com/taskforcesh/bullmq/commit/7eae65340820043101fadf1f87802f506020d553))

* feat: add support for adding jobs in bulk ([`b62bddc`](https://github.com/taskforcesh/bullmq/commit/b62bddc054b266a809b4b1646558a095a276d6d1))

* feat: add cleaned event ([`c544775`](https://github.com/taskforcesh/bullmq/commit/c544775803626b5f03cf6f7c3cf18ed1d92debab))

* feat: support global:progress event ([`60f4d85`](https://github.com/taskforcesh/bullmq/commit/60f4d85d332b3be4a80db7aa179f3a9ceeb1d6f8))

* feat: make delay in backoffs optional ([`30d59e5`](https://github.com/taskforcesh/bullmq/commit/30d59e519794780a8198222d0bbd88779c623275))

* feat: add retry errors ([`f6a7990`](https://github.com/taskforcesh/bullmq/commit/f6a7990fb74585985729c5d95e2238acde6cf74a))

* feat: add empty method ([`4376112`](https://github.com/taskforcesh/bullmq/commit/4376112369d869c0a5c7ab4a543cfc50200e1414))

* feat: remove support of bull3 config format in compat class ([`d909486`](https://github.com/taskforcesh/bullmq/commit/d9094868e34c2af21f810aaef4542951a509ccf8))

* feat: add some new tests for compat class, more minor fixes ([`bc0f653`](https://github.com/taskforcesh/bullmq/commit/bc0f653ecf7aedd5a46eee6f912ecd6849395dca))

* feat: get rid of Job3 in favor of bullmq Job class ([`7590cea`](https://github.com/taskforcesh/bullmq/commit/7590ceae7abe32a8824e4a265f95fef2f9a6665f))

* feat: port more features from bull 3.x ([`75bd261`](https://github.com/taskforcesh/bullmq/commit/75bd26158678ee45a14e04fd7c3a1f96219979a2))

* feat: ported tests and functionality from bull 3 ([`1b6b192`](https://github.com/taskforcesh/bullmq/commit/1b6b1927c7e8e6b6f1bf0bbd6c74eb59cc17deb6))

* feat: port a lot of functionality from bull 3.x ([`ec9f3d2`](https://github.com/taskforcesh/bullmq/commit/ec9f3d266c1aca0c27cb600f056d813c81259b4c))

### Fix

* fix(connections): reused connections ([`1e808d2`](https://github.com/taskforcesh/bullmq/commit/1e808d24018a29f6611f4fccd2f5754de0fa3e39))

* fix: do not trim if maxEvents is undefined ([`7edd8f4`](https://github.com/taskforcesh/bullmq/commit/7edd8f47b392c8b3a7369196befdafa4b29421d1))

* fix: reworked initialization of redis clients ([`c17d4be`](https://github.com/taskforcesh/bullmq/commit/c17d4be5a2ecdda3efcdc6b9d7aecdfaccd06d83))

* fix: add extra client to worker fixes #34 ([`90bd891`](https://github.com/taskforcesh/bullmq/commit/90bd891c7514f5e9e397d7aad15069ee55bebacd))

* fix: make ioredis typings a normal dependency ([`fb80b90`](https://github.com/taskforcesh/bullmq/commit/fb80b90b12931a12a1a93c5e204dbf90eed4f48f))

* fix: fix compiling error ([`3cf2617`](https://github.com/taskforcesh/bullmq/commit/3cf261703292d263d1e2017ae30eb490121dab4e))

* fix: fix several floating promises ([`590a4a9`](https://github.com/taskforcesh/bullmq/commit/590a4a925167a7c7d6c0d9764bbb5ab69235beb7))

* fix: initialize events comsumption in constructor ([`dbb66cd`](https://github.com/taskforcesh/bullmq/commit/dbb66cda9722d44eca806fa6ad1cabdaabac846a))

* fix: replace init by waitUntilReady ([`4336161`](https://github.com/taskforcesh/bullmq/commit/43361610de5b1a993a1c65f3f21ac745b8face21))

* fix: several fixes to make the lib work on other ts projects ([`3cac1b0`](https://github.com/taskforcesh/bullmq/commit/3cac1b0715613d9df51cb1ed6fe0859bcfbb8e9b))

* fix: improve disconnection for queue events ([`56b53a1`](https://github.com/taskforcesh/bullmq/commit/56b53a1aca1e527b50f04d906653060fe8ca644e))

* fix: do not exec if closing ([`b1d1c08`](https://github.com/taskforcesh/bullmq/commit/b1d1c08a2948088eeb3dd65de78085329bac671b))

* fix: default opts ([`333c73b`](https://github.com/taskforcesh/bullmq/commit/333c73b5819a263ae92bdb54f0406c19db5cb64f))

* fix: check closing after resuming from pause ([`7b2cef3`](https://github.com/taskforcesh/bullmq/commit/7b2cef3677e2b3af0370e0023aec4b971ad313fe))

* fix: do not block if blockTime is zero ([`13b2df2`](https://github.com/taskforcesh/bullmq/commit/13b2df20cf045c069b8b581751e117722681dcd4))

* fix: throw error messages instead of codes ([`9267541`](https://github.com/taskforcesh/bullmq/commit/92675413f1c3b9564574dc264ffcab0d6089e70e))

* fix: remove unused dependencies ([`34293c8`](https://github.com/taskforcesh/bullmq/commit/34293c84bb0ed54f18d70c86821c3ac627d376a5))

* fix: add missing dependency ([`b92e330`](https://github.com/taskforcesh/bullmq/commit/b92e330aad35ae54f43376f92ad1b41209012b76))

* fix: remove buggy close() on redis-connection (fixes 5 failing tests) ([`64c2ede`](https://github.com/taskforcesh/bullmq/commit/64c2edec5e738f43676d0f4ca61bdea8609203fc))

* fix: fix retry functionality ([`ec41ea4`](https://github.com/taskforcesh/bullmq/commit/ec41ea4e0bd88b10b1ba434ef5ceb0952bb59f7b))

* fix: add compilation step before running tests ([`64abc13`](https://github.com/taskforcesh/bullmq/commit/64abc13681f8735fb3ee5add5b271bb4da618047))

* fix: fixed reprocess lua script ([`b78296f`](https://github.com/taskforcesh/bullmq/commit/b78296f33517b8c5d79b300fef920edd03149d2f))

* fix: improve concurrency mechanism ([`a3f6148`](https://github.com/taskforcesh/bullmq/commit/a3f61489e3c9891f42749ff85bd41064943c62dc))

* fix: fix progress script ([`4228e27`](https://github.com/taskforcesh/bullmq/commit/4228e2768c0cf404e09642ebb4053147d0badb56))

* fix: properly emit event for progress ([`3f70175`](https://github.com/taskforcesh/bullmq/commit/3f701750b1c957027825ee90b58141cd2556694f))

* fix: parse progres and return value in events ([`9e43d0e`](https://github.com/taskforcesh/bullmq/commit/9e43d0e30ab90a290942418718cde1f5bfbdcf56))

* fix: waitUntilFinished improvements ([`18d4afe`](https://github.com/taskforcesh/bullmq/commit/18d4afef08f04d19cb8d931e02fff8f962d07ee7))

* fix: minor fixes ([`7791cda`](https://github.com/taskforcesh/bullmq/commit/7791cdac2bfb6a7fbbab9c95c5d89b1eae226a4c))

* fix: update tests after merge ([`51f75a4`](https://github.com/taskforcesh/bullmq/commit/51f75a4929e7ae2704e42fa9035e335fe60d8dc0))

* fix: fix a couple of job tests ([`e66b97b`](https://github.com/taskforcesh/bullmq/commit/e66b97be4577d5ab373fff0f3f45d73de7842a37))

* fix: reduce drain delay to 5 seconds ([`c6cfe7c`](https://github.com/taskforcesh/bullmq/commit/c6cfe7c0b50cabe5e5eb31f4b631a8b1d3706611))

* fix: fix more tests ([`6a07b35`](https://github.com/taskforcesh/bullmq/commit/6a07b3518f856e8f7158be032110c925ed5c924f))

* fix: emit wait event in add job ([`39cba31`](https://github.com/taskforcesh/bullmq/commit/39cba31a30b7ef762a8d55d4bc34efec636207bf))

* fix: wait until ready before trying to get jobs ([`f3b768f`](https://github.com/taskforcesh/bullmq/commit/f3b768f251ddafa207466af552376065b35bec8f))

### Test

* test: fix tests for node 12 ([`edefbbf`](https://github.com/taskforcesh/bullmq/commit/edefbbf9d2fdbf54f5c869016f18333736a5cf75))

* test: listen before adding in pause test ([`df8f86f`](https://github.com/taskforcesh/bullmq/commit/df8f86f2a49ac4a0073a1c68ccdaa1332e6d9089))

* test: add small delay for failing test ([`b30e00b`](https://github.com/taskforcesh/bullmq/commit/b30e00b7637605f27b7f9039775227a75b72d29a))

* test: fix drain event tests ([`95b842f`](https://github.com/taskforcesh/bullmq/commit/95b842f20a73bd67d0178b27f1146de5196a6caa))

* test: minor test fixes ([`2b0d8f3`](https://github.com/taskforcesh/bullmq/commit/2b0d8f3bc2aa153003001bb54fd59f3fcba9ed99))

* test: some minor test fixes ([`d41fd97`](https://github.com/taskforcesh/bullmq/commit/d41fd9796947a25cf2b870d6470c9caa03ff9b5f))

* test: multiple clean ups ([`7b49aa7`](https://github.com/taskforcesh/bullmq/commit/7b49aa74e47f0b2aa789e49d7aee50e32ec49a0c))

* test: add workers test ([`74cf2d2`](https://github.com/taskforcesh/bullmq/commit/74cf2d2fa931658761df7a721adba581bd2f9b23))

* test: add stalled jobs tests ([`ba1e4a4`](https://github.com/taskforcesh/bullmq/commit/ba1e4a4bca5ed5f3ff21419b040137c8cbd2d5c7))

* test: fix broken tests related to worker closing connection ([`a4e1cae`](https://github.com/taskforcesh/bullmq/commit/a4e1cae8a2c686243a8bc0ea432d7030ad469255))

* test: fix test title ([`ea01775`](https://github.com/taskforcesh/bullmq/commit/ea0177504193c544510b991df7e755b1d7073d77))

* test: reorder test code ([`1425df0`](https://github.com/taskforcesh/bullmq/commit/1425df0dd611791590f3823ee8ba5333f9d0b723))

* test: add queue clean tests ([`4bba23a`](https://github.com/taskforcesh/bullmq/commit/4bba23a5ce5d8171c6dc5640effd8a9efa0393bf))

* test: fix style ([`45be9f3`](https://github.com/taskforcesh/bullmq/commit/45be9f37d2590646deac46592bdaa8af2ecabd33))

* test: add several tests for workers ([`f8125a6`](https://github.com/taskforcesh/bullmq/commit/f8125a690752e284480fdf0fe5cce66cf53564d3))

* test: fix failing test ([`9b78d4b`](https://github.com/taskforcesh/bullmq/commit/9b78d4bba401b1138af2849611f03191985bb3bb))

* test: fix repeat related tests ([`0dbbde8`](https://github.com/taskforcesh/bullmq/commit/0dbbde8593e64d6ce2e2158eff809de8ce29d30b))

* test: skip failing test ([`f7c8b60`](https://github.com/taskforcesh/bullmq/commit/f7c8b604af13b999aab217a91a040fa9bbf0ee99))

* test: minor fixes ([`3aaf069`](https://github.com/taskforcesh/bullmq/commit/3aaf0694f7766fb89843025b7085a4cfa65525b1))

### Unknown

* Merge pull request #46 from taskforcesh/chore/add-semantic-release-plugins

chore: add missing dependency ([`d30413a`](https://github.com/taskforcesh/bullmq/commit/d30413a655605ef351f03ce1d5f69fba52d5e91d))

* Merge branch &#39;master&#39; into chore/add-semantic-release-plugins ([`dedf5ae`](https://github.com/taskforcesh/bullmq/commit/dedf5aebabdadb31379874741704b88d5fa10154))

* Merge branch &#39;master&#39; into fix-cleanup-dependencies ([`ff2fbd2`](https://github.com/taskforcesh/bullmq/commit/ff2fbd2c353f1d3580697082599504bca769556d))

* Merge pull request #45 from taskforcesh/chore/add-semantic-release-plugins

chore: add missing dependencies ([`5e06e66`](https://github.com/taskforcesh/bullmq/commit/5e06e66f74d4bb334e6354b6a1840c5844a20472))

* Merge branch &#39;master&#39; into chore/add-semantic-release-plugins ([`b81f6fd`](https://github.com/taskforcesh/bullmq/commit/b81f6fd7366f9de943615f99298189f791ab43fa))

* Merge pull request #44 from taskforcesh/chore/add-semantic-release-plugins

chore: add semantic release plugins ([`0466161`](https://github.com/taskforcesh/bullmq/commit/0466161c2e66a17ad8b64e3c4165eb231629cfd9))

* Merge branch &#39;master&#39; into chore/add-semantic-release-plugins ([`695f595`](https://github.com/taskforcesh/bullmq/commit/695f5954fdd971c32ca644701bdf59c795884dea))

* Merge branch &#39;master&#39; into fix-cleanup-dependencies ([`81bbf55`](https://github.com/taskforcesh/bullmq/commit/81bbf55aee9f75d188a23702e29ff55064bba285))

* Merge pull request #41 from taskforcesh/feat/support-async-backoffs

Feat/support async backoffs ([`c0b4618`](https://github.com/taskforcesh/bullmq/commit/c0b46181366be8e0a9d52fa5503b49ac33a4aa9d))

* Merge branch &#39;master&#39; into fix-cleanup-dependencies ([`4bfc011`](https://github.com/taskforcesh/bullmq/commit/4bfc011fb64e76f5a93a2ca59bfe883efd52d2d6))

* Merge branch &#39;master&#39; into feat/support-async-backoffs ([`1f009d5`](https://github.com/taskforcesh/bullmq/commit/1f009d508d81e2c038b509bac1cb480a540e28c6))

* Merge pull request #42 from taskforcesh/feat/implement-connection-close

feat: implement close in redis connection fixes #8 ([`84c7ba9`](https://github.com/taskforcesh/bullmq/commit/84c7ba9f7ec079c22f27e50983656f267ea92983))

* Merge branch &#39;master&#39; into feat/support-async-backoffs ([`74ae600`](https://github.com/taskforcesh/bullmq/commit/74ae60079abeb97eef794816a99bbaf417c8d11b))

* Merge pull request #40 from taskforcesh/fix/fix-handling-reused-connections

fix(connections): reused connections ([`cc8d38e`](https://github.com/taskforcesh/bullmq/commit/cc8d38e74fbe4b95b836c66a70f421e40bdc3775))

* Merge branch &#39;master&#39; into fix/fix-handling-reused-connections ([`8bece44`](https://github.com/taskforcesh/bullmq/commit/8bece44a218978df8447c5af0931df18eac9a45d))

* GitBook: [master] one page modified ([`69545e1`](https://github.com/taskforcesh/bullmq/commit/69545e1d1914e1b25d826b7eb1d785425dc79ad2))

* GitBook: [master] 9 pages modified ([`45b91c5`](https://github.com/taskforcesh/bullmq/commit/45b91c56346ffafc4e46c2e1275c1ed236f88318))

* GitBook: [master] 2 pages modified ([`5c396a4`](https://github.com/taskforcesh/bullmq/commit/5c396a4e1bbc7c8ee4d73ee68675190ad0a1813b))

* Merge branch &#39;master&#39; into fix-cleanup-dependencies ([`36fc8fb`](https://github.com/taskforcesh/bullmq/commit/36fc8fb2ad9fc9b9fe0a04d3908386f97cf5e8a6))

* GitBook: [master] 9 pages modified ([`7af1ecf`](https://github.com/taskforcesh/bullmq/commit/7af1ecf8cb303e8e5eeccd24b7fe50327d95c35a))

* GitBook: [master] 6 pages and one asset modified ([`85b331b`](https://github.com/taskforcesh/bullmq/commit/85b331bd565b507d47c3e4e929474de477404d8b))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`6a99814`](https://github.com/taskforcesh/bullmq/commit/6a99814f30702414e28044f66588c3a9f8d8a293))

* Rename changelog.md to CHANGELOG.md ([`d6845f8`](https://github.com/taskforcesh/bullmq/commit/d6845f82b2052f9f3983de503b6680b2c6d27872))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`4e6f8ed`](https://github.com/taskforcesh/bullmq/commit/4e6f8ed2e798ced02f7b9ff9b6bed5e243aa17d4))

* Update changelog.md ([`2b9d863`](https://github.com/taskforcesh/bullmq/commit/2b9d8637ca663dbb734421c7511195fe09a09bd7))

* GitBook: [master] 22 pages and one asset modified ([`00a3490`](https://github.com/taskforcesh/bullmq/commit/00a34903b0961a5f34f5bcaa25bc2406c000748f))

* Create changelog.md ([`4738be2`](https://github.com/taskforcesh/bullmq/commit/4738be2bdb1a8612ac5f1097505770d31e3e1988))

* Merge branch &#39;master&#39; of github.com:taskforcesh/bullmq ([`1caec42`](https://github.com/taskforcesh/bullmq/commit/1caec42910a808b5b38166e96852ce59c3546bd2))

* 4.0.0-beta.2 ([`0cf1b2c`](https://github.com/taskforcesh/bullmq/commit/0cf1b2c3a9179c94804d49fb7c49a9cc5d0bbc6e))

* Merge pull request #35 from taskforcesh/fix/34-extra-connection-for-workers

Fix/#34 extra connection for workers ([`2604753`](https://github.com/taskforcesh/bullmq/commit/2604753984a03d079ece28db0686d734ee10ba52))

* Merge branch &#39;fix/34-extra-connection-for-workers&#39; of github.com:taskforcesh/bullmq into fix/34-extra-connection-for-workers ([`91cd22a`](https://github.com/taskforcesh/bullmq/commit/91cd22a8b7f821cb0c7f7734dc6456e743668f3e))

* Merge branch &#39;master&#39; into fix/34-extra-connection-for-workers ([`f201f8b`](https://github.com/taskforcesh/bullmq/commit/f201f8b2c07e597810763671e53f4fa47538cc08))

* Update README.md ([`968f276`](https://github.com/taskforcesh/bullmq/commit/968f27696e860617dc8978f3b2c11323a99ce8a4))

* Merge pull request #33 from taskforcesh/chore/move-ioredis-typings-as-dependency

fix: make ioredis typings a normal dependency ([`5d35db5`](https://github.com/taskforcesh/bullmq/commit/5d35db5a8238dccb0f7e09a0e4d2bdd63ab7e837))

* Update README.md ([`1e960c0`](https://github.com/taskforcesh/bullmq/commit/1e960c029de75c29d6b2389d66a121dd37f52e7d))

* Merge pull request #27 from taskforcesh/feat/add-trim-option-#21

Feat/add trim option #21 ([`47fd1ea`](https://github.com/taskforcesh/bullmq/commit/47fd1ea5eec49dcb9d74293b8f99ed5aecc01239))

* Merge branch &#39;feat/add-trim-option-#21&#39; of github.com:taskforcesh/bullmq into feat/add-trim-option-#21 ([`d0c24cf`](https://github.com/taskforcesh/bullmq/commit/d0c24cf6c235e2a845a8a63a3cf9b8ee2aa8357d))

* Merge branch &#39;master&#39; into feat/add-trim-option-#21 ([`dd53469`](https://github.com/taskforcesh/bullmq/commit/dd53469ad41ef1b4e1e8c8bcb91327f7f29b34e0))

* Update README.md ([`b695e36`](https://github.com/taskforcesh/bullmq/commit/b695e36f66095edc50a06874247e383e522dad85))

* Merge branch &#39;master&#39; into feat/add-trim-option-#21 ([`63d344f`](https://github.com/taskforcesh/bullmq/commit/63d344f33cad87ddb3a60d8887c9ef1bfec81740))

* Update README.md ([`3f15dde`](https://github.com/taskforcesh/bullmq/commit/3f15dde1c8764090c33c382f059db2f6c181506e))

* Update README.md ([`4f3311d`](https://github.com/taskforcesh/bullmq/commit/4f3311d6664f476ea8109bcfd838f9aae1571ca3))

* Update README.md ([`6e50b31`](https://github.com/taskforcesh/bullmq/commit/6e50b31fa4c152d4b5fba552bfb5fdfa400f2c8e))

* Merge branch &#39;master&#39; into feat/add-trim-option-#21 ([`90277f4`](https://github.com/taskforcesh/bullmq/commit/90277f47eafa140b2bba0476fbddd79a2421bafe))

* Merge pull request #26 from taskforcesh/manast-patch-1

Update README.md ([`99c9513`](https://github.com/taskforcesh/bullmq/commit/99c9513772efc78be0ecdd811e8e136cc9aaeffd))

* Merge branch &#39;master&#39; into feat/add-trim-option-#21 ([`9c13107`](https://github.com/taskforcesh/bullmq/commit/9c131075fc83ccdc0a0c6d3f1211d4b7226f8ee5))

* Update README.md ([`d742889`](https://github.com/taskforcesh/bullmq/commit/d742889f90176f32d7768352a9d77f3e558b0cee))

* Merge pull request #25 from taskforcesh/manast-patch-1

Update README.md ([`e21a98a`](https://github.com/taskforcesh/bullmq/commit/e21a98a1e95016f72ad0109150f56a6fe8e00a17))

* Merge branch &#39;manast-patch-1&#39; of github.com:taskforcesh/bullmq into manast-patch-1 ([`d0a533e`](https://github.com/taskforcesh/bullmq/commit/d0a533eab0136784de9c0285232d6129a37e140a))

* Update README.md ([`007c3d5`](https://github.com/taskforcesh/bullmq/commit/007c3d5c3a6449a864b4c1292f8f7203d99c573f))

* Merge pull request #20 from taskforcesh/feat/development-4.0

Feat/development 4.0 ([`e4a9614`](https://github.com/taskforcesh/bullmq/commit/e4a9614b843caacd4dc01e7266daaae036cc12e9))

* Merge pull request #7 from taskforcesh/feat-bull3-compat-api-v2

Compatibility class implementing bull3 api in bullmq ([`da7af7a`](https://github.com/taskforcesh/bullmq/commit/da7af7a319dd3f12acad7794f8fc27a251838d87))

* Merge branch &#39;development-4.0&#39; into feat-bull3-compat-api-v2 ([`70e00ec`](https://github.com/taskforcesh/bullmq/commit/70e00ec1f347ab24a06bfaea25f31305e36667a0))

* Merge branch &#39;development-4.0&#39; into feat-bull3-compat-api-v2 ([`33b19bd`](https://github.com/taskforcesh/bullmq/commit/33b19bd8cee85af0efef743c62098a64ce0b8bf7))

* Merge branch &#39;development-4.0&#39; of github.com:taskforcesh/bullmq into development-4.0 ([`65ea27b`](https://github.com/taskforcesh/bullmq/commit/65ea27b551af70508a8262a9774c38035863382f))

* Merge pull request #3 from taskforcesh/feat-port-sandbox-processing

port sandbox processors implementation and tests from bull 3.x ([`88a72e4`](https://github.com/taskforcesh/bullmq/commit/88a72e40eadef581a704bb5235e839184b435fb8))

* npm install sinon (spies tool for tests) ([`c1778af`](https://github.com/taskforcesh/bullmq/commit/c1778af865c9d014a1091e3cd3027a6ca9cef317))

* implement close() on our RedisConnection ([`db3aba9`](https://github.com/taskforcesh/bullmq/commit/db3aba9a97e2a2c01cf99846f22a448e3b9939d2))

* adapt some tests from v3 for compat class ([`24a2abe`](https://github.com/taskforcesh/bullmq/commit/24a2abec5309860ef71e64315873483833cc2216))

* make prettier ([`4886fa2`](https://github.com/taskforcesh/bullmq/commit/4886fa2a7eba3beaf1c5e41c50093972cf0c80e0))

* minor fixes in compat class ([`bf6c69f`](https://github.com/taskforcesh/bullmq/commit/bf6c69f460356a784ae6a0fe0661874241f24eef))

* add suffix to defs from bull3 instead of V4 prefix on bullmq classes ([`f3a0601`](https://github.com/taskforcesh/bullmq/commit/f3a06012fc0587396b7378b9d39af35932921c4c))

* add support of local and global events ([`e62bca1`](https://github.com/taskforcesh/bullmq/commit/e62bca1ad73a18ea4192168134129ac8993d6a93))

* implement job methods where possible; forward props access to inner v4Job ([`278bc77`](https://github.com/taskforcesh/bullmq/commit/278bc77bb9e9fc14c295316fa52f004a81c83a80))

* use v4 prefix for wrapped objects to better separate them ([`aa49369`](https://github.com/taskforcesh/bullmq/commit/aa49369d4b53e44e189df7ba2219af714144b5cc))

* implement queue.add() ([`d6c9ebd`](https://github.com/taskforcesh/bullmq/commit/d6c9ebd58f98452860fb4e1988fdd0403ef1add5))

* implement some more getters

getJobs, getJobCounts, getJobCountByTypes, getCompletedCount, getFailedCount,
getDelayedCount, getWaitingCount, getPausedCount, getActiveCount, getRepeatableCount,
getWorkers, base64Name, clientName, parseClientList ([`e78e9bf`](https://github.com/taskforcesh/bullmq/commit/e78e9bf75dd2aff39e7d226087dcafb6dc1109bf))

* implement job getters and repeatable jobs functions ([`29eeb4c`](https://github.com/taskforcesh/bullmq/commit/29eeb4c1bcb2f7ceb9769b4681cae953b83ea6c4))

* implement implement pause, resume, count, close and getJob ([`4f43bb1`](https://github.com/taskforcesh/bullmq/commit/4f43bb1ed0f22f4877fe66fd6fe382c2217a23f2))

* implement queue.process() ([`1017ea6`](https://github.com/taskforcesh/bullmq/commit/1017ea63ac0add1b66ddfbfc39598669703c330b))

* implement queue/job options converters ([`736c1e0`](https://github.com/taskforcesh/bullmq/commit/736c1e03fa1d087f57ac15cdc5da3172907902c5))

* implement queue constructor ([`6dc880d`](https://github.com/taskforcesh/bullmq/commit/6dc880d03bf06d25f948200fc166a75f97b75281))

* restore queue constructor (only call with  supported for now) ([`1d1a761`](https://github.com/taskforcesh/bullmq/commit/1d1a761fb6218d75ad3515725174aa5b3acc435f))

* stub implementations for job and queue objects ([`cc51ac3`](https://github.com/taskforcesh/bullmq/commit/cc51ac3b6d38926d061cfed9e6f3e2241f318e88))

* reorganize structure of compat.ts ([`926f653`](https://github.com/taskforcesh/bullmq/commit/926f653f784cdcde3e0bc07a8fa87149fc54f74c))

* import existing typescript definitions from dt project (master)

source: https://github.com/DefinitelyTyped/DefinitelyTyped ([`87e0ef1`](https://github.com/taskforcesh/bullmq/commit/87e0ef182189e458a55c2e38e72893aa84b26aa6))

* rewrite master.js in typescript ([`5ced75d`](https://github.com/taskforcesh/bullmq/commit/5ced75d7a51003bee3040fba45396b5efc4c10cf))

* replace promise chains with async/await ([`548c911`](https://github.com/taskforcesh/bullmq/commit/548c91163a253e0a1dcddfcb376a1a604850849b))

* finally fixed test for sandboxed processors ([`67d4ebe`](https://github.com/taskforcesh/bullmq/commit/67d4ebe3bbf7e37567da8bb403399b34997d198c))

* merge changes from development-4.0 ([`bd05c1a`](https://github.com/taskforcesh/bullmq/commit/bd05c1aee275673033fd9b2597fbdf0173132b8e))

* run prettier ([`44cb575`](https://github.com/taskforcesh/bullmq/commit/44cb5756020fa7a5906904068ff90712634597bc))

* port sandbox processors implementation and tests from bull 3.x ([`8658e61`](https://github.com/taskforcesh/bullmq/commit/8658e614bf80e802684c7d771f6dcd6b969dde49))

* GitBook: [master] 2 pages modified ([`4d28ad5`](https://github.com/taskforcesh/bullmq/commit/4d28ad514e2d13e0badbec08ad9ea3d518e55982))

* Initial commit ([`43e5efc`](https://github.com/taskforcesh/bullmq/commit/43e5efcd9bc60505d111715df23090d3e91d5bf7))
