# Changelog

<!--next-version-placeholder-->

## v2.12.0 (2025-02-21)
### Feature
* **queue:** Support removeGlobalConcurrency method ([#3076](https://github.com/taskforcesh/bullmq/issues/3076)) ([`ece8532`](https://github.com/taskforcesh/bullmq/commit/ece853203adb420466dfaf3ff8bccc73fb917147))
* **job:** Add moveToWait method for manual processing ([#2978](https://github.com/taskforcesh/bullmq/issues/2978)) ([`5a97491`](https://github.com/taskforcesh/bullmq/commit/5a97491a0319df320b7858657e03c357284e0108))
* **job-scheduler:** Revert add delayed job and update in the same script ([`9f0f1ba`](https://github.com/taskforcesh/bullmq/commit/9f0f1ba9b17874a757ac38c1878792c0df3c5a9a))
* **job-scheduler:** Save limit option ([#3033](https://github.com/taskforcesh/bullmq/issues/3033)) ([`a1571ea`](https://github.com/taskforcesh/bullmq/commit/a1571ea03be6c6c41794fa272c38c29588351bbf))
* **queue:** Add option to skip wait until connection ready ([`e728299`](https://github.com/taskforcesh/bullmq/commit/e72829922d4234b92290346dce5d33f5b98ee373))
* **queue-getters:** Add prometheus exporter ([`078ae9d`](https://github.com/taskforcesh/bullmq/commit/078ae9db80f6ca64ff0a8135b57a6dc71d71cb1e))
* **job-scheduler:** Save iteration count ([#3018](https://github.com/taskforcesh/bullmq/issues/3018)) ([`ad5c07c`](https://github.com/taskforcesh/bullmq/commit/ad5c07cc7672a3f7a7185310b1250763a5fef76b))
* **sandbox:** Add support for getChildrenValues ([`dcc3b06`](https://github.com/taskforcesh/bullmq/commit/dcc3b0628f992546d7b93f509795e5d4eb3e1b15))
* **telemetry:** Add option to omit context propagation on jobs ([#2946](https://github.com/taskforcesh/bullmq/issues/2946)) ([`6514c33`](https://github.com/taskforcesh/bullmq/commit/6514c335231cb6e727819cf5e0c56ed3f5132838))
* Replace multi by lua scripts in moveToFailed ([#2958](https://github.com/taskforcesh/bullmq/issues/2958)) ([`c19c914`](https://github.com/taskforcesh/bullmq/commit/c19c914969169c660a3e108126044c5152faf0cd))
* **queue:** Enhance getJobSchedulers method to include template information (#2956) ref #2875 ([`5b005cd`](https://github.com/taskforcesh/bullmq/commit/5b005cd94ba0f98677bed4a44f8669c81f073f26))
* **queue:** Enhance getJobScheduler method to include template information (#2929) ref #2875 ([`cb99080`](https://github.com/taskforcesh/bullmq/commit/cb990808db19dd79b5048ee99308fa7d1eaa2e9f))
* **queue:** Add getJobSchedulersCount method ([#2945](https://github.com/taskforcesh/bullmq/issues/2945)) ([`38820dc`](https://github.com/taskforcesh/bullmq/commit/38820dc8c267c616ada9931198e9e3e9d2f0d536))

### Fix
* **worker:** Do not execute run method when no processor is defined when resuming ([#3089](https://github.com/taskforcesh/bullmq/issues/3089)) ([`4a66933`](https://github.com/taskforcesh/bullmq/commit/4a66933496db68a84ec7eb7c153fcedb7bd14c7b))
* **worker:** Do not resume when closing ([#3080](https://github.com/taskforcesh/bullmq/issues/3080)) ([`024ee0f`](https://github.com/taskforcesh/bullmq/commit/024ee0f3f0e808c256712d3ccb1bcadb025eb931))
* **job:** Set processedBy when moving job to active in moveToFinished (#3077) fixes #3073 ([`1aa970c`](https://github.com/taskforcesh/bullmq/commit/1aa970ced3c55949aea6726c4ad29531089f5370))
* **drain:** Pass delayed key for redis cluster ([#3074](https://github.com/taskforcesh/bullmq/issues/3074)) ([`05ea32b`](https://github.com/taskforcesh/bullmq/commit/05ea32b7e4f0cd4099783fd81d2b3214d7a293d5))
* **job-scheduler:** Restore limit option to be saved ([#3071](https://github.com/taskforcesh/bullmq/issues/3071)) ([`3e649f7`](https://github.com/taskforcesh/bullmq/commit/3e649f7399514b343447ed2073cc07e4661f7390))
* **job-scheduler:** Return undefined in getJobScheduler when it does not exist (#3065) fixes #3062 ([`548cc1c`](https://github.com/taskforcesh/bullmq/commit/548cc1ce8080042b4b44009ea99108bd24193895))
* Fix return type of getNextJob ([`b970281`](https://github.com/taskforcesh/bullmq/commit/b9702812e6961f0f5a834f66d43cfb2feabaafd8))
* **worker:** Wait fetched jobs to be processed when closing ([#3059](https://github.com/taskforcesh/bullmq/issues/3059)) ([`d4de2f5`](https://github.com/taskforcesh/bullmq/commit/d4de2f5e88d57ea00274e62ab23d09f4806196f8))
* **worker:** Evaluate if a job needs to be fetched when moving to failed ([#3043](https://github.com/taskforcesh/bullmq/issues/3043)) ([`406e21c`](https://github.com/taskforcesh/bullmq/commit/406e21c9aadd7670f353c1c6b102a401fc327653))
* **retry-job:** Consider updating failures in job ([#3036](https://github.com/taskforcesh/bullmq/issues/3036)) ([`21e8495`](https://github.com/taskforcesh/bullmq/commit/21e8495b5f2bf5418d86f60b59fad25d306a0298))
* **flow-producer:** Add support for skipWaitingForReady ([`6d829fc`](https://github.com/taskforcesh/bullmq/commit/6d829fceda9f204f193c533ffc780962692b8f16))
* **worker:** Avoid possible hazard in closing worker ([`0f07467`](https://github.com/taskforcesh/bullmq/commit/0f0746727176d7ff285ae2d1f35048109b4574c5))
* **job-scheduler:** Use delayed job data when template data is not present (#3010) fixes #3009 ([`95edb40`](https://github.com/taskforcesh/bullmq/commit/95edb4008fcd32f09ec0953d862692d4ac7608c0))
* **job-scheduler:** Add next delayed job only when prevMillis matches with producerId ([#3001](https://github.com/taskforcesh/bullmq/issues/3001)) ([`4ea35dd`](https://github.com/taskforcesh/bullmq/commit/4ea35dd9e16ff0197f204210696f41c0c5bd0e30))
* **job-scheduler:** Avoid duplicates when upserting in a quick sequence ([#2991](https://github.com/taskforcesh/bullmq/issues/2991)) ([`e8cdb99`](https://github.com/taskforcesh/bullmq/commit/e8cdb99881bc7cebbc48cb7834da5eafa289712f))
* **dynamic-rate-limit:** Validate job lock cases ([#2975](https://github.com/taskforcesh/bullmq/issues/2975)) ([`8bb27ea`](https://github.com/taskforcesh/bullmq/commit/8bb27ea4438cbd11e85fa4d0aa516bd1c0e7d51b))
* **sandbox:** Fix issue where job could stay in active forever ([#2979](https://github.com/taskforcesh/bullmq/issues/2979)) ([`c0a6bcd`](https://github.com/taskforcesh/bullmq/commit/c0a6bcdf9594540ef6c8ec08df28550f4f5e1950))
* **sandboxed:** Fix detecting special errors by sending default messages (#2967) fixes #2962 ([`52b0e34`](https://github.com/taskforcesh/bullmq/commit/52b0e34f0a38ac71ebd0667a5fa116ecd73ae4d2))
* **scripts:** Make sure jobs fields are not empty before unpack ([`4360572`](https://github.com/taskforcesh/bullmq/commit/4360572745a929c7c4f6266ec03d4eba77a9715c))
* **job-scheduler:** Avoid duplicated delayed jobs when repeatable jobs are retried ([`af75315`](https://github.com/taskforcesh/bullmq/commit/af75315f0c7923f5e0a667a9ed4606b28b89b719))
* Guarantee every repeatable jobs are slotted ([`9917df1`](https://github.com/taskforcesh/bullmq/commit/9917df166aff2e2f143c45297f41ac8520bfc8ae))
* **job-scheduler:** Omit deduplication and debounce options from template options ([#2960](https://github.com/taskforcesh/bullmq/issues/2960)) ([`b5fa6a3`](https://github.com/taskforcesh/bullmq/commit/b5fa6a3208a8f2a39777dc30c2db2f498addb907))
* **worker:** Catch connection error when moveToActive is called ([#2952](https://github.com/taskforcesh/bullmq/issues/2952)) ([`544fc7c`](https://github.com/taskforcesh/bullmq/commit/544fc7c9e4755e6b62b82216e25c0cb62734ed59))
* **scheduler-template:** Remove console.log when getting template information ([#2950](https://github.com/taskforcesh/bullmq/issues/2950)) ([`3402bfe`](https://github.com/taskforcesh/bullmq/commit/3402bfe0d01e5e5205db74d2106cd19d7df53fcb))
* **flow:** Allow using removeOnFail and failParentOnFailure in parents (#2947) fixes #2229 ([`85f6f6f`](https://github.com/taskforcesh/bullmq/commit/85f6f6f181003fafbf75304a268170f0d271ccc3))
* **job-scheduler:** Upsert template when same pattern options are provided (#2943) ref #2940 ([`b56c3b4`](https://github.com/taskforcesh/bullmq/commit/b56c3b45a87e52f5faf25406a2b992d1bfed4900))

### Documentation
* Fix link to use https ([`62075cf`](https://github.com/taskforcesh/bullmq/commit/62075cfbee32e2a8d115b58de2401fa9a64e6671))
* **readme:** Fix broken link to contributing ([#3047](https://github.com/taskforcesh/bullmq/issues/3047)) ([`63e6245`](https://github.com/taskforcesh/bullmq/commit/63e62450bee6721ffe588a5043a4f8d78df7d21f))
* **bullmq-pro:** Update changelog to v7.26.3 ([#3031](https://github.com/taskforcesh/bullmq/issues/3031)) ([`a4d5efb`](https://github.com/taskforcesh/bullmq/commit/a4d5efb8903d9ae9bedc40dbce4a6242ba9c3a1a))
* **connections:** Clarify the usage of prefix option instead of keyPrefix ([#3029](https://github.com/taskforcesh/bullmq/issues/3029)) ([`68b0d33`](https://github.com/taskforcesh/bullmq/commit/68b0d33a569e34df206d02c12098c7b819dbd608))
* **connections:** Clarify maxRetriesPerRequest usage ([#3028](https://github.com/taskforcesh/bullmq/issues/3028)) ([`3709687`](https://github.com/taskforcesh/bullmq/commit/3709687c5fbf1ae3d3b3a491d79a546cc654b100))
* Fix several grammar errors in docs ([#3011](https://github.com/taskforcesh/bullmq/issues/3011)) ([`490d902`](https://github.com/taskforcesh/bullmq/commit/490d902c1baf28d8785989ec78f263783ca9cf81))
* **stop-retrying:** Clarify different between attemptMade and attemptsStarted ([#3003](https://github.com/taskforcesh/bullmq/issues/3003)) ([`14c9fed`](https://github.com/taskforcesh/bullmq/commit/14c9fed50b5e6e4030f61a01a811e85bf5d0007b))
* Rename pr_template.md to pull_request_template.md ([`e8ca2ec`](https://github.com/taskforcesh/bullmq/commit/e8ca2ecbd884d6991a1b837d1becfb890c923645))
*  create pr_template.md ([`6c4101a`](https://github.com/taskforcesh/bullmq/commit/6c4101ace86f7f19883091fd879082c6a0cc20e7))
* Typo in docstring for `moveToDelayed` ([#2961](https://github.com/taskforcesh/bullmq/issues/2961)) ([`3b218ff`](https://github.com/taskforcesh/bullmq/commit/3b218ff3a3af4286068b7aaee8f0d0909fd4f52e))
* Add missing closing quote ([#2957](https://github.com/taskforcesh/bullmq/issues/2957)) ([`6b5c3de`](https://github.com/taskforcesh/bullmq/commit/6b5c3de4b0c5b4b1eb51f7f6c4cc006dfe18132a))
* **guide:** Provide connection details in getting started section (#2897) fixes #2838 ([`ba28e37`](https://github.com/taskforcesh/bullmq/commit/ba28e37d77676be8e359d828474cd5e351df47af))
* Update README.md ([`f1dfbad`](https://github.com/taskforcesh/bullmq/commit/f1dfbad4b9c7cc74313004ea47d51bf910943d18))
* **job-schedulers:** Add getJobScheduler documentation ([#2953](https://github.com/taskforcesh/bullmq/issues/2953)) ([`fb871dd`](https://github.com/taskforcesh/bullmq/commit/fb871dd87323246438521f997a77ac8ae2d22942))

### Performance
* **delayed:** Add marker once when promoting delayed jobs (#3096) (python) ([`38912fb`](https://github.com/taskforcesh/bullmq/commit/38912fba969d614eb44d05517ba2ec8bc418a16e))
* **add-job:** Add job into wait or prioritized state when delay is provided as 0 ([#3052](https://github.com/taskforcesh/bullmq/issues/3052)) ([`3e990eb`](https://github.com/taskforcesh/bullmq/commit/3e990eb742b3a12065110f33135f282711fdd7b9))
* **job-scheduler:** Add delayed job and update scheduler in same script ([#2997](https://github.com/taskforcesh/bullmq/issues/2997)) ([`9be28a0`](https://github.com/taskforcesh/bullmq/commit/9be28a0c4a907798a447d02ca50662c12333dd82))
* **job-scheduler:** Add delayed job and scheduler in same script ([#2993](https://github.com/taskforcesh/bullmq/issues/2993)) ([`95718e8`](https://github.com/taskforcesh/bullmq/commit/95718e888ba64b4071f21bbe0823b55a51ab145c))

## v2.11.0 (2024-11-26)
### Feature
* **queue:** Add getDelayedCount method [python] ([#2934](https://github.com/taskforcesh/bullmq/issues/2934)) ([`71ce75c`](https://github.com/taskforcesh/bullmq/commit/71ce75c04b096b5593da0986c41a771add1a81ce))

### Performance
* **marker:** Add base markers while consuming jobs to get workers busy (#2904) fixes #2842 ([`1759c8b`](https://github.com/taskforcesh/bullmq/commit/1759c8bc111cab9e43d5fccb4d8d2dccc9c39fb4))

## v2.10.1 (2024-10-26)
### Fix
* **commands:** Add missing build statement when releasing [python] (#2869) fixes #2868 ([`ff2a47b`](https://github.com/taskforcesh/bullmq/commit/ff2a47b37c6b36ee1a725f91de2c6e4bcf8b011a))

## v2.10.0 (2024-10-24)
### Feature
* **job:** Add getChildrenValues method [python] ([#2853](https://github.com/taskforcesh/bullmq/issues/2853)) ([`0f25213`](https://github.com/taskforcesh/bullmq/commit/0f25213b28900a1c35922bd33611701629d83184))
* **queue:** Add option to skip metas update ([`b7dd925`](https://github.com/taskforcesh/bullmq/commit/b7dd925e7f2a4468c98a05f3a3ca1a476482b6c0))
* **queue:** Add queue version support ([#2822](https://github.com/taskforcesh/bullmq/issues/2822)) ([`3a4781b`](https://github.com/taskforcesh/bullmq/commit/3a4781bf7cadf04f6a324871654eed8f01cdadae))
* **job:** Expose priority value ([#2804](https://github.com/taskforcesh/bullmq/issues/2804)) ([`9abec3d`](https://github.com/taskforcesh/bullmq/commit/9abec3dbc4c69f2496c5ff6b5d724f4d1a5ca62f))
* **job:** Add deduplication logic ([#2796](https://github.com/taskforcesh/bullmq/issues/2796)) ([`0a4982d`](https://github.com/taskforcesh/bullmq/commit/0a4982d05d27c066248290ab9f59349b802d02d5))
* **queue:** Add getDebounceJobId method ([#2717](https://github.com/taskforcesh/bullmq/issues/2717)) ([`a68ead9`](https://github.com/taskforcesh/bullmq/commit/a68ead95f32a7d9dabba602895d05c22794b2c02))

### Fix
* Proper way to get version ([`b4e25c1`](https://github.com/taskforcesh/bullmq/commit/b4e25c13cafc001748ee6eb590133feb8ee24d7b))
* **redis:** Use version for naming loaded lua scripts ([`fe73f6d`](https://github.com/taskforcesh/bullmq/commit/fe73f6d4d776dc9f99ad3a094e5c59c5fafc96f1))
* **repeat:** Also consider startDate when using "every" ([`25bbaa8`](https://github.com/taskforcesh/bullmq/commit/25bbaa81af87f9944a64bc4fb7e0c76ef223ada4))
* **repeatable:** Avoid delayed job deletion if next job already existed ([#2778](https://github.com/taskforcesh/bullmq/issues/2778)) ([`6a851c1`](https://github.com/taskforcesh/bullmq/commit/6a851c1140b336f0e458b6dfe1022470ac41fceb))

## v2.9.4 (2024-09-10)
### Fix
* **metrics:** Differentiate points in different minutes to be more accurate (#2766) (python) ([`7cb670e`](https://github.com/taskforcesh/bullmq/commit/7cb670e1bf9560a24de3da52427b4f6b6152a59a))
* **repeat:** Replace delayed job when updating repeat key ([`88029bb`](https://github.com/taskforcesh/bullmq/commit/88029bbeab2a58768f9c438318f540010cd286a7))

### Performance
* **metrics:** Save zeros as much as max data points ([#2758](https://github.com/taskforcesh/bullmq/issues/2758)) ([`3473054`](https://github.com/taskforcesh/bullmq/commit/347305451a9f5d7f2c16733eb139b5de96ea4b9c))

## v2.9.3 (2024-08-31)
### Fix
* **flows:** Throw error when queueName contains colon (#2719) fixes #2718 ([`9ef97c3`](https://github.com/taskforcesh/bullmq/commit/9ef97c37663e209f03c501a357b6b1a662b24d99))
* **flow:** Remove debounce key when parent is moved to fail ([#2720](https://github.com/taskforcesh/bullmq/issues/2720)) ([`d51aabe`](https://github.com/taskforcesh/bullmq/commit/d51aabe999a489c285f871d21e36c3c84e2bef33))
* **flow:** Recursive ignoreDependencyOnFailure option ([#2712](https://github.com/taskforcesh/bullmq/issues/2712)) ([`53bc9eb`](https://github.com/taskforcesh/bullmq/commit/53bc9eb68b5bb0a470a8fe64ef78ece5cde44632))
* **job:** Throw error if removeDependencyOnFailure and ignoreDependencyOnFailure are used together ([#2711](https://github.com/taskforcesh/bullmq/issues/2711)) ([`967632c`](https://github.com/taskforcesh/bullmq/commit/967632c9ef8468aab59f0b36d1d828bcde1fbd70))
* **stalled:** Support removeDependencyOnFailure option when job is stalled ([#2708](https://github.com/taskforcesh/bullmq/issues/2708)) ([`e0d3790`](https://github.com/taskforcesh/bullmq/commit/e0d3790e755c4dfe31006b52f177f08b40348e61))
* **job:** Change moveToFinished return type to reflect jobData (#2706) ref #2342 ([`de094a3`](https://github.com/taskforcesh/bullmq/commit/de094a361a25886acbee0112bb4341c6b285b1c9))
* **connection:** Remove unnecessary process.env.CI reference ([#2705](https://github.com/taskforcesh/bullmq/issues/2705)) ([`53de304`](https://github.com/taskforcesh/bullmq/commit/53de3049493ef79e02af40e8e450e2056c134155))
* **worker:** Fix close sequence to reduce risk for open handlers ([#2656](https://github.com/taskforcesh/bullmq/issues/2656)) ([`8468e44`](https://github.com/taskforcesh/bullmq/commit/8468e44e5e9e39c7b65691945c26688a9e5d2275))

## v2.9.2 (2024-08-10)
### Fix
* **flow:** Validate parentData before ignoreDependencyOnFailure when stalled check happens (#2702) (python) ([`9416501`](https://github.com/taskforcesh/bullmq/commit/9416501551b1ad464e59bdba1045a5a9955e2ea4))

### Performance
* **worker:** Promote delayed jobs while queue is rate limited (#2697) ref #2582 ([`f3290ac`](https://github.com/taskforcesh/bullmq/commit/f3290ace2f117e26357f9fae611a255af26b950b))

## v2.9.1 (2024-08-08)
### Fix
* **job:** Consider passing stackTraceLimit as 0 (#2692) ref #2487 ([`509a36b`](https://github.com/taskforcesh/bullmq/commit/509a36baf8d8cf37176e406fd28e33f712229d27))

## v2.9.0 (2024-08-02)
### Feature
* **queue-events:** Pass debounceId as a param of debounced event ([#2678](https://github.com/taskforcesh/bullmq/issues/2678)) ([`97fb97a`](https://github.com/taskforcesh/bullmq/commit/97fb97a054d6cebbe1d7ff1cb5c46d7da1c018d8))
* **job:** Allow passing a debounce as option ([#2666](https://github.com/taskforcesh/bullmq/issues/2666)) ([`163ccea`](https://github.com/taskforcesh/bullmq/commit/163ccea19ef48191c4db6da27638ff6fb0080a74))
* **repeatable:** New repeatables structure (#2617) ref #2612 fixes #2399 #2596 ([`8376a9a`](https://github.com/taskforcesh/bullmq/commit/8376a9a9007f58ac7eab1a3a1c2f9e7ec373bbd6))
* **queue:** Support global concurrency (#2496) ref #2465 ([`47ba055`](https://github.com/taskforcesh/bullmq/commit/47ba055c1ea36178b684fd11c1e82cde7ec93ac8))

### Fix
* **job:** Make sure json.dumps return JSON compliant JSON [python] ([#2683](https://github.com/taskforcesh/bullmq/issues/2683)) ([`4441711`](https://github.com/taskforcesh/bullmq/commit/4441711a986a9f6a326100308d639eb0a2ea8c8d))
* **repeatable:** Remove repeat hash when removing repeatable job ([#2676](https://github.com/taskforcesh/bullmq/issues/2676)) ([`97a297d`](https://github.com/taskforcesh/bullmq/commit/97a297d90ad8b27bcddb7db6a8a158acfb549389))
* **repeatable:** Keep legacy repeatables if it exists instead of creating one with new structure ([#2665](https://github.com/taskforcesh/bullmq/issues/2665)) ([`93fad41`](https://github.com/taskforcesh/bullmq/commit/93fad41a9520961d0e6814d82454bc916a039501))
* **repeatable:** Consider removing legacy repeatable job (#2658) fixes #2661 ([`a6764ae`](https://github.com/taskforcesh/bullmq/commit/a6764aecb557fb918d061f5e5c2e26e4afa3e8ee))
* **repeatable:** Pass custom key as an args in addRepeatableJob to prevent CROSSSLOT issue (#2662) fixes #2660 ([`9d8f874`](https://github.com/taskforcesh/bullmq/commit/9d8f874b959e09662985f38c4614b95ab4d5e89c))

### Performance
* **worker:** Fetch next job on failure ([#2342](https://github.com/taskforcesh/bullmq/issues/2342)) ([`f917b80`](https://github.com/taskforcesh/bullmq/commit/f917b8090f306c0580aac12f6bd4394fd9ef003d))

## v2.8.1 (2024-07-11)
### Fix
* **delayed:** Avoid using jobId in order to schedule delayed jobs (#2587) (python) ([`228db2c`](https://github.com/taskforcesh/bullmq/commit/228db2c780a1ca8323900fc568156495a13355a3))

### Performance
* **delayed:** Keep moving delayed jobs to waiting when queue is paused (#2640) (python) ([`b89e2e0`](https://github.com/taskforcesh/bullmq/commit/b89e2e0913c0886561fc1c2470771232f17f5b3b))

## v2.8.0 (2024-07-10)
### Feature
* **queue:** Add getCountsPerPriority method [python] ([#2607](https://github.com/taskforcesh/bullmq/issues/2607)) ([`02b8338`](https://github.com/taskforcesh/bullmq/commit/02b83380334879cc2434043141566f2a375db958))

### Fix
* **parent:** Consider re-adding child that is in completed state using same jobIds (#2627) (python) fixes #2554 ([`00cd017`](https://github.com/taskforcesh/bullmq/commit/00cd0174539fbe1cc4628b9b6e1a7eb87a5ef705))
* **priority:** Consider paused state when calling getCountsPerPriority (python) ([#2609](https://github.com/taskforcesh/bullmq/issues/2609)) ([`6e99250`](https://github.com/taskforcesh/bullmq/commit/6e992504b2a7a2fa76f1d04ad53d1512e98add7f))
* **priority:** Use module instead of bit.band to keep order (python) ([#2597](https://github.com/taskforcesh/bullmq/issues/2597)) ([`9ece15b`](https://github.com/taskforcesh/bullmq/commit/9ece15b17420fe0bee948a5307e870915e3bce87))

## v2.7.8 (2024-06-05)
### Fix
* Remove print calls [python] ([#2579](https://github.com/taskforcesh/bullmq/issues/2579)) ([`f957186`](https://github.com/taskforcesh/bullmq/commit/f95718689864dbaca8a6b4113a6b37727919d6df))

## v2.7.7 (2024-06-04)
### Fix
* **retry-job:** Throw error when job is not in active state ([#2576](https://github.com/taskforcesh/bullmq/issues/2576)) ([`ca207f5`](https://github.com/taskforcesh/bullmq/commit/ca207f593d0ed455ecc59d9e0ef389a9a50d9634))
* **job:** Validate job existence when adding a log ([#2562](https://github.com/taskforcesh/bullmq/issues/2562)) ([`f87e3fe`](https://github.com/taskforcesh/bullmq/commit/f87e3fe029e48d8964722da762326e531c2256ee))

### Performance
* **job:** Set processedBy using hmset (#2592) (python) ([`238680b`](https://github.com/taskforcesh/bullmq/commit/238680b84593690a73d542dbe1120611c3508b47))

## v2.7.6 (2024-05-09)
### Fix
* **connection:** Use async Retry (#2555) [python] ([`d6dd21d`](https://github.com/taskforcesh/bullmq/commit/d6dd21d3ac28660bbfa7825bba0b586328769709))
* **worker:** Make sure clearTimeout is always called after bzpopmin ([`782382e`](https://github.com/taskforcesh/bullmq/commit/782382e599218024bb9912ff0572c4aa9b1f22a3))
* **worker:** Force timeout on bzpopmin command ([#2543](https://github.com/taskforcesh/bullmq/issues/2543)) ([`ae7cb6c`](https://github.com/taskforcesh/bullmq/commit/ae7cb6caefdbfa5ca0d28589cef4b896ffcce2db))

## v2.7.5 (2024-04-28)

### Fix

- **worker:** Wait for jobs to finalize on close (#2545) [python] ([`d81f210`](https://github.com/taskforcesh/bullmq/commit/d81f210a5f5968fc040e820946fb672deb24bd01))

## v2.7.4 (2024-04-26)

### Fix

- **redis-connection:** Increase redis retry strategy backoff (#2546) [python] ([`6cf7712`](https://github.com/taskforcesh/bullmq/commit/6cf77122da845e5b0afa1607348cf06602679329))

## v2.7.3 (2024-04-24)

### Fix

- **stalled:** Consider ignoreDependencyOnFailure option (python) (#2540) fixes #2531 ([`0140959`](https://github.com/taskforcesh/bullmq/commit/0140959cabd2613794631e41ebe4c2ddee6f91da))

## v2.7.2 (2024-04-20)

### Fix

- **worker:** Return minimumBlockTimeout depending on redis version (python) ([#2532](https://github.com/taskforcesh/bullmq/issues/2532)) ([`83dfb63`](https://github.com/taskforcesh/bullmq/commit/83dfb63e72a1a36a4dfc40f122efb54fbb796339))

## v2.7.1 (2024-04-18)

### Fix

- **stalled:** Consider failParentOnFailure when moving child into failed (#2526) fixes #2464 (python) ([`5e31eb0`](https://github.com/taskforcesh/bullmq/commit/5e31eb096169ea57350db591bcebfc2264a6b6dc))

## v2.7.0 (2024-04-13)

### Feature

- **queue:** Add getJobLogs method [python] (#2523) ref #2472 ([`a24a16e`](https://github.com/taskforcesh/bullmq/commit/a24a16ea2707541ee06ec3c4d636cd30dcdaade5))

## v2.6.0 (2024-04-13)

### Feature

- **worker:** Use 0.002 as minimum timeout for redis version lower than 7.0.8 [python] ([#2521](https://github.com/taskforcesh/bullmq/issues/2521)) ([`f3862dd`](https://github.com/taskforcesh/bullmq/commit/f3862dd0c85cf2c2122fb0306c5f4b5eb8ad0bcd))
- Allow arbitrary large drainDelay ([`9693321`](https://github.com/taskforcesh/bullmq/commit/96933217bf79658e5bb23fd7afe47e0b1150a40d))

### Fix

- **worker:** Use 0.002 as minimum timeout for redis version lower than 7.0.8 (#2515) fixes #2466 ([`44f7d21`](https://github.com/taskforcesh/bullmq/commit/44f7d21850747d9c636c78e08b9e577d684fb885))

## v2.5.0 (2024-04-08)

### Feature

- **python:** Support reusable redis connections ([`29ad8c8`](https://github.com/taskforcesh/bullmq/commit/29ad8c83596b14a312ad1cd375e0e34d4fdecc52))

## v2.4.0 (2024-04-07)

### Performance

- **stalled:** Remove jobId from stalled after removing lock when moved from active (#2512) (python) ([`64feec9`](https://github.com/taskforcesh/bullmq/commit/64feec91b0b034fe640a846166bd95b546ff6d71))

## v2.3.3 (2024-03-24)

### Fix

- **connection:** Accept all parameters for redis connection [python] ([#2486](https://github.com/taskforcesh/bullmq/issues/2486)) ([`ce30192`](https://github.com/taskforcesh/bullmq/commit/ce30192ad30f66fb0f39c8c9ed669ddd133346c8))

## v2.3.2 (2024-03-23)

### Fix

- **scripts:** Use command name in error message when moving to finished ([#2483](https://github.com/taskforcesh/bullmq/issues/2483)) ([`3c335d4`](https://github.com/taskforcesh/bullmq/commit/3c335d49ba637145648c1ef0864d8e0d297dd890))

## v2.3.1 (2024-03-19)

### Fix

- **worker:** Set blockTimeout as 0.001 when reach the time to get delayed jobs [python] ([#2478](https://github.com/taskforcesh/bullmq/issues/2478)) ([`b385034`](https://github.com/taskforcesh/bullmq/commit/b385034006ac183a26093f593269349eb78f8b54))

## v2.3.0 (2024-03-16)

### Feature

- **job:** Add log method [python] (#2476) ref #2472 ([`34946c4`](https://github.com/taskforcesh/bullmq/commit/34946c4b29cc9e7d5ae81f8fd170a2e539ac6279))

## v2.2.4 (2024-02-13)

### Fix

- **flow:** Parent job cannot be replaced (python) ([#2417](https://github.com/taskforcesh/bullmq/issues/2417)) ([`2696ef8`](https://github.com/taskforcesh/bullmq/commit/2696ef8200058b7f616938c2166a3b0454663b39))

## v2.2.3 (2024-02-10)

### Performance

- **marker:** Differentiate standard and delayed markers (python) ([#2389](https://github.com/taskforcesh/bullmq/issues/2389)) ([`18ebee8`](https://github.com/taskforcesh/bullmq/commit/18ebee8c242f66f1b5b733d68e48c574b1f1fdef))
- **change-delay:** Add delay marker when needed ([#2411](https://github.com/taskforcesh/bullmq/issues/2411)) ([`8b62d28`](https://github.com/taskforcesh/bullmq/commit/8b62d28a06347e9dd04757807fce1b511ace79bc))

## v2.2.2 (2024-02-03)

### Fix

- **reprocess-job:** Add marker if needed ([#2406](https://github.com/taskforcesh/bullmq/issues/2406)) ([`5923ed8`](https://github.com/taskforcesh/bullmq/commit/5923ed885f5451eee2f14258767d7d5f8d80ae13))
- **rate-limit:** Move job to wait even if ttl is 0 ([#2403](https://github.com/taskforcesh/bullmq/issues/2403)) ([`c1c2ccc`](https://github.com/taskforcesh/bullmq/commit/c1c2cccc7c8c05591f0303e011d46f6efa0942a0))
- **stalled:** Consider adding marker when moving job back to wait ([#2384](https://github.com/taskforcesh/bullmq/issues/2384)) ([`4914df8`](https://github.com/taskforcesh/bullmq/commit/4914df87e416711835291e81da93b279bd758254))

### Performance

- **flow:** Add marker when moving parent to wait (python) ([#2408](https://github.com/taskforcesh/bullmq/issues/2408)) ([`6fb6896`](https://github.com/taskforcesh/bullmq/commit/6fb6896701ae7595e1cb5e2cdbef44625c48d673))
- **move-to-active:** Check rate limited once ([#2391](https://github.com/taskforcesh/bullmq/issues/2391)) ([`ca6c17a`](https://github.com/taskforcesh/bullmq/commit/ca6c17a43e38d5339e62471ea9f59c62a169b797))

## v2.2.1 (2024-01-16)

### Fix

- **retry-jobs:** Add marker when needed ([#2374](https://github.com/taskforcesh/bullmq/issues/2374)) ([`1813d5f`](https://github.com/taskforcesh/bullmq/commit/1813d5fa12b7db69ee6c8c09273729cda8e3e3b5))

## v2.2.0 (2024-01-14)

### Feature

- **queue:** Add promoteJobs method [python] ([#2377](https://github.com/taskforcesh/bullmq/issues/2377)) ([`3b9de96`](https://github.com/taskforcesh/bullmq/commit/3b9de967efa34ea22cdab1fbc7ff65d49927d787))

## v2.1.0 (2024-01-12)

### Feature

- **repeatable:** Allow saving custom key ([#1824](https://github.com/taskforcesh/bullmq/issues/1824)) ([`8ea0e1f`](https://github.com/taskforcesh/bullmq/commit/8ea0e1f76baf36dab94a66657c0f432492cb9999))

### Fix

- **redis:** Upgrade to v5 [python] ([#2364](https://github.com/taskforcesh/bullmq/issues/2364)) ([`d5113c8`](https://github.com/taskforcesh/bullmq/commit/d5113c88ad108b281b292e2890e0eef3be41c8fb))
- **worker:** Worker can be closed if Redis is down ([#2350](https://github.com/taskforcesh/bullmq/issues/2350)) ([`888dcc2`](https://github.com/taskforcesh/bullmq/commit/888dcc2dd40571e05fe1f4a5c81161ed062f4542))

## v2.0.0 (2023-12-23)

### Feature

- **job:** Add isActive method [python] ([#2352](https://github.com/taskforcesh/bullmq/issues/2352)) ([`afb5e31`](https://github.com/taskforcesh/bullmq/commit/afb5e31484ed2e5a1c381c732321225c0a8b78ff))
- **job:** separate attemptsMade from attemptsStarted when manually moving a job ([#2203](https://github.com/taskforcesh/bullmq/issues/2203)) ([`0e88e4f`](https://github.com/taskforcesh/bullmq/commit/0e88e4fe4ed940487dfc79d1345d0686de22d0c6))
- **scripts:** Use new queue markers ([`4276eb7`](https://github.com/taskforcesh/bullmq/commit/4276eb725ca294ddbfc00c4edc627bb2cb5d403a))
- **worker:** Improved markers handling ([`73cf5fc`](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) ([`0bac0fb`](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))

### Fix

- **connection:** Unify redis connection args for Queue and Worker ([#2282](https://github.com/taskforcesh/bullmq/issues/2282)) ([`8eee20f`](https://github.com/taskforcesh/bullmq/commit/8eee20f1210a49024eeee6647817f0659b8c3893))

### Breaking

- Markers use now a dedicated key in redis instead of using a special Job ID. ([`73cf5fc`](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) ([`0bac0fb`](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))
- Connection must be provided as part of options ([#2282](https://github.com/taskforcesh/bullmq/issues/2282)) ([`8eee20f`](https://github.com/taskforcesh/bullmq/commit/8eee20f1210a49024eeee6647817f0659b8c3893))

## v1.24.0 (2023-12-21)

### Feature

- **job:** Add isWaitingChildren method [python] ([#2345](https://github.com/taskforcesh/bullmq/issues/2345)) ([`e9c1fa1`](https://github.com/taskforcesh/bullmq/commit/e9c1fa10b258ebe171a0396c29b6ccb05aef2608))

## v1.23.0 (2023-12-18)

### Feature

- **queue:** Add getRateLimitTtl method [python] ([#2340](https://github.com/taskforcesh/bullmq/issues/2340)) ([`f0a1f70`](https://github.com/taskforcesh/bullmq/commit/f0a1f7084478f7899233021fbb4d4307c94dfead))

## v1.22.0 (2023-12-14)

### Feature

- **job:** Add isFailed method [python] ([#2333](https://github.com/taskforcesh/bullmq/issues/2333)) ([`19bfccc`](https://github.com/taskforcesh/bullmq/commit/19bfccc2d7734b150a5fbb6ea720fcd9887c9dd3))

## v1.21.0 (2023-12-14)

### Feature

- **job:** Add isCompleted method [python] ([#2331](https://github.com/taskforcesh/bullmq/issues/2331)) ([`364f0c1`](https://github.com/taskforcesh/bullmq/commit/364f0c1f2d4247d2b24041ab9ece0e429110d454))

## v1.20.0 (2023-12-13)

### Feature

- **job:** Add isWaiting method [python] ([#2328](https://github.com/taskforcesh/bullmq/issues/2328)) ([`5db9f95`](https://github.com/taskforcesh/bullmq/commit/5db9f957939cd873eea0224d34569189e5520e84))

## v1.19.0 (2023-12-12)

### Feature

- **job:** Add promote method [python] ([#2323](https://github.com/taskforcesh/bullmq/issues/2323)) ([`61f4ba3`](https://github.com/taskforcesh/bullmq/commit/61f4ba3e99486aa36e5cc3d9b448b8080c567eb1))

## v1.18.0 (2023-12-10)

### Fix

- **retry:** Pass right redis command name into retryJob script (#2321) [python] ([`6bb21a0`](https://github.com/taskforcesh/bullmq/commit/6bb21a07c9754659fa5aa1734df1046a6da5d16a))
- **flows:** Add meta key to queues created with flows ([`272ec69`](https://github.com/taskforcesh/bullmq/commit/272ec69557f601a138e1aaba739f7e7878d5344b))
- **update-progress:** Remove old updateProgress script to prevent conflict (#2298) (python) ([`e65b819`](https://github.com/taskforcesh/bullmq/commit/e65b819101f8e0e8fdef8c51cfdf9a52f5e73f13))
- **worker:** Should cap update progress events ([`2cab9e9`](https://github.com/taskforcesh/bullmq/commit/2cab9e94f65c7bdd053e3fb5944bcda6e3ebaa39))

## v1.17.0 (2023-11-24)

### Feature

- **worker:** Better handling of concurrency when fetching jobs ([#2242](https://github.com/taskforcesh/bullmq/issues/2242)) ([`d2e2035`](https://github.com/taskforcesh/bullmq/commit/d2e203588878ee64cb21e67141f73b32867dfb40))

### Fix

- **worker:** Do not wait for slow jobs fixes #2290 ([`568d758`](https://github.com/taskforcesh/bullmq/commit/568d7585edb1f2ef15991d4ae4a2425e6834046a))

## v1.16.1 (2023-11-09)

### Fix

- **job:** Set delay value on current job instance when it is retried (#2266) (python) ([`76e075f`](https://github.com/taskforcesh/bullmq/commit/76e075f54d5745b6cec3cb11305bf3110d963eae))

## v1.16.0 (2023-11-08)

### Fix

- **backoff:** Fix builtin backoff type (#2265) [python] ([`76959eb`](https://github.com/taskforcesh/bullmq/commit/76959eb9d9495eb1b6d2d31fab93c8951b5d3b93))

## v1.15.4 (2023-11-05)

### Fix

- Update delay job property when moving to delayed set ([#2261](https://github.com/taskforcesh/bullmq/issues/2261)) ([`69ece08`](https://github.com/taskforcesh/bullmq/commit/69ece08babd7716c14c38c3dd50630b44c7c1897))

## v1.15.3 (2023-11-05)

### Fix

- **add-job:** Trim events when waiting-children event is published (#2262) (python) ([`198bf05`](https://github.com/taskforcesh/bullmq/commit/198bf05fa5a4e1ce50081296033a2e0f26ece498))

## v1.15.2 (2023-10-18)

### Fix

- **events:** Do not publish removed event on non-existent jobs ([#2227](https://github.com/taskforcesh/bullmq/issues/2227)) ([`c134606`](https://github.com/taskforcesh/bullmq/commit/c1346064c6cd9f93c59b184f150eac11d51c91b4))
- **events:** Trim events when retrying a job ([#2224](https://github.com/taskforcesh/bullmq/issues/2224)) ([`1986b05`](https://github.com/taskforcesh/bullmq/commit/1986b05ac03fe4ee48861aa60caadcc9df8170a6))

### Performance

- **events:** Trim events when removing jobs (#2235) (python) ([`889815c`](https://github.com/taskforcesh/bullmq/commit/889815c412666e5fad8f32d2e3a2d41cf650f001))

## v1.15.1 (2023-10-04)

### Fix

- **delayed:** Trim events when moving jobs to delayed (python) ([#2211](https://github.com/taskforcesh/bullmq/issues/2211)) ([`eca8c2d`](https://github.com/taskforcesh/bullmq/commit/eca8c2d4dfeafbd8ac36a49764dbd4897303628c))

## v1.15.0 (2023-09-30)

### Feature

- Nothing change

## v1.14.0 (2023-09-26)

### Feature

- **queue:** Add clean method [python] ([#2194](https://github.com/taskforcesh/bullmq/issues/2194)) ([`3b67193`](https://github.com/taskforcesh/bullmq/commit/3b6719379cbec5beb1b7dfb5f06d46cbbf74010f))

### Fix

- **move-to-finished:** Stringify any return value [python] (#2198) fixes #2196 ([`07f1335`](https://github.com/taskforcesh/bullmq/commit/07f13356eb1c0136f03dfdf946d163f0ef3c4d62))
- **queue:** Batched unpack now uses range ([#2188](https://github.com/taskforcesh/bullmq/issues/2188)) ([`b5e97f4`](https://github.com/taskforcesh/bullmq/commit/b5e97f420bc0c4bc82772f3e87883ee522be43d9))
- **queue:** Differentiate score purpose per state in clean method (#2133) fixes #2124 ([`862f10b`](https://github.com/taskforcesh/bullmq/commit/862f10b586276314d9bffff2a5e6caf939399f7e))

## v1.13.2 (2023-09-12)

### Fix

- **remove:** Change error message when job is locked (python) ([#2175](https://github.com/taskforcesh/bullmq/issues/2175)) ([`2f5628f`](https://github.com/taskforcesh/bullmq/commit/2f5628feffab66cdcc78abf4d7bb608bdcaa65bb))

## v1.13.1 (2023-09-11)

### Fix

- **move-to-finished:** Consider addition of prioritized jobs when processing last active job (#2176) (python) ([`4b01f35`](https://github.com/taskforcesh/bullmq/commit/4b01f359c290cfc62ea74ff3ab0b43ccc6956a02))

## v1.13.0 (2023-09-07)

### Feature

- **flow-producer:** Add addBulk method (python) ([#2174](https://github.com/taskforcesh/bullmq/issues/2174)) ([`c67dfb4`](https://github.com/taskforcesh/bullmq/commit/c67dfb49931ee4cb96573af660e9f2316942687c))

## v1.12.0 (2023-08-31)

### Feature

- **queue:** Add addBulk method ([#2161](https://github.com/taskforcesh/bullmq/issues/2161)) ([`555dd44`](https://github.com/taskforcesh/bullmq/commit/555dd44a0190f4957e43f083e2f59d7f58b90ac9))

## v1.11.0 (2023-08-26)

### Feature

- Add flow producer class ([#2115](https://github.com/taskforcesh/bullmq/issues/2115)) ([`14a769b`](https://github.com/taskforcesh/bullmq/commit/14a769b193d97576ff9b3f2a65de47463ba04ffd))

## v1.10.1 (2023-08-19)

### Fix

- **job:** Job getReturnValue not returning returnvalue ([#2143](https://github.com/taskforcesh/bullmq/issues/2143)) ([`dcb8e6a`](https://github.com/taskforcesh/bullmq/commit/dcb8e6a8e62346fac8574bd9aac56c5a25589a2c))

### Performance

- **rate-limit:** Get pttl only if needed ([#2129](https://github.com/taskforcesh/bullmq/issues/2129)) ([`12ce2f3`](https://github.com/taskforcesh/bullmq/commit/12ce2f3746626a81ea961961bb1a629077eed68a))

## v1.10.0 (2023-08-03)

### Feature

- **redis-connection:** Add username option into redisOpts ([#2108](https://github.com/taskforcesh/bullmq/issues/2108)) ([`d27f33e`](https://github.com/taskforcesh/bullmq/commit/d27f33e997d30e6c0c7d4484bea338347c3fe67e))

### Performance

- **retry:** Compare prev state instead of regex expression ([#2099](https://github.com/taskforcesh/bullmq/issues/2099)) ([`c141283`](https://github.com/taskforcesh/bullmq/commit/c1412831903d1fae0955af097e0be049024839fe))

## v1.9.0 (2023-07-18)

### Feature

- **job:** Add option for removing children in remove method (python) ([#2064](https://github.com/taskforcesh/bullmq/issues/2064)) ([`841dc87`](https://github.com/taskforcesh/bullmq/commit/841dc87a689897df81438ad1f43e45a4da77c388))

## v1.8.0 (2023-07-17)

### Fix

- **worker:** Respect concurrency (#2062) fixes #2063 ([`1b95185`](https://github.com/taskforcesh/bullmq/commit/1b95185e8f4a4349037b59e61455bdec79792644))

## v1.7.0 (2023-07-14)

### Feature

- **queue:** Add remove method ([#2066](https://github.com/taskforcesh/bullmq/issues/2066)) ([`808ee72`](https://github.com/taskforcesh/bullmq/commit/808ee7231c75d4d826881f25e346f01b2fd2dc23))
- **worker:** Add id as part of token ([#2061](https://github.com/taskforcesh/bullmq/issues/2061)) ([`e255356`](https://github.com/taskforcesh/bullmq/commit/e2553562271e1e4143a8fef616349bb30de4899d))

## v1.6.1 (2023-07-10)

### Fix

- **pyproject:** Add requires-python config (#2056) fixes #1979 ([`a557970`](https://github.com/taskforcesh/bullmq/commit/a557970c755d370ed23850e2f32af35774002bc9))

## v1.6.0 (2023-07-06)

### Feature

- **job:** Add moveToWaitingChildren method ([#2049](https://github.com/taskforcesh/bullmq/issues/2049)) ([`6d0e224`](https://github.com/taskforcesh/bullmq/commit/6d0e224cd985069055786f447b0ba7c394a76b8a))

## v1.5.0 (2023-07-04)

### Fix

- **queue:** Fix isPaused method when custom prefix is present ([#2047](https://github.com/taskforcesh/bullmq/issues/2047)) ([`7ec1c5b`](https://github.com/taskforcesh/bullmq/commit/7ec1c5b2ccbd575ecd50d339f5377e204ca7aa16))

## v1.4.0 (2023-06-30)

### Feature

- **queue:** Add getJobState method ([#2040](https://github.com/taskforcesh/bullmq/issues/2040)) ([`8ec9ed6`](https://github.com/taskforcesh/bullmq/commit/8ec9ed67d2803224a3b866c51f67239a5c4b7042))

## v1.3.1 (2023-06-29)

### Fix

- **pyproject:** Build egg-info at the root location ([`3c2d06e`](https://github.com/taskforcesh/bullmq/commit/3c2d06e7e6e0944135fe6bd8045d08dd43fe7d9c))

## v1.3.0 (2023-06-29)

### Feature

- **queue:** Add getFailedCount method ([#2036](https://github.com/taskforcesh/bullmq/issues/2036)) ([`92d7227`](https://github.com/taskforcesh/bullmq/commit/92d7227bf5ec63a75b7af3fc7c312d9b4a81d69f))
- **queue:** Add getCompletedCount method ([#2033](https://github.com/taskforcesh/bullmq/issues/2033)) ([`3e9db5e`](https://github.com/taskforcesh/bullmq/commit/3e9db5ef4d868f8b420e368a711c20c2568a5910))

### Fix

- **release:** Add recommended pyproject.toml configuration ([#2029](https://github.com/taskforcesh/bullmq/issues/2029)) ([`d03ffc9`](https://github.com/taskforcesh/bullmq/commit/d03ffc9c98425a96d6e9dd47a6625382556a4cbf))

## v1.2.0 (2023-06-24)

### Feature

- **queue:** Add get job methods by state ([#2012](https://github.com/taskforcesh/bullmq/issues/2012)) ([`57b2b72`](https://github.com/taskforcesh/bullmq/commit/57b2b72f79afb683067d49170df5d2eed46e3712))

## v1.1.0 (2023-06-23)

### Feature

- **queue:** Add getJobs method ([#2011](https://github.com/taskforcesh/bullmq/issues/2011)) ([`8d5d6c1`](https://github.com/taskforcesh/bullmq/commit/8d5d6c14442b7b967c42cb6ec3907a4d1a5bd575))

## v1.0.0 (2023-06-21)

### Breaking

- priority is separeted in its own zset, no duplication needed ([`42a890a`](https://github.com/taskforcesh/bullmq/commit/42a890a2bfe45b29348030f886766400f5d41aa3))

### Performance

- **priority:** Add prioritized as a new state (#1984) (python) ([`42a890a`](https://github.com/taskforcesh/bullmq/commit/42a890a2bfe45b29348030f886766400f5d41aa3))

## v0.5.6 (2023-06-21)

### Fix

- **queue:** Pass right params to trimEvents method ([#2004](https://github.com/taskforcesh/bullmq/issues/2004)) ([`a55fd77`](https://github.com/taskforcesh/bullmq/commit/a55fd777655f7d4bb7af9e4fa2f7b4f48f559189))

## v0.5.5 (2023-06-16)

### Fix

- **rate-limit:** Keep priority fifo order (#1991) fixes #1929 (python) ([`56bd7ad`](https://github.com/taskforcesh/bullmq/commit/56bd7ad8c4daffcfb1f9f199abfc5d6495eb291e))
- **worker:** Set redis version always in initialization (#1989) fixes #1988 ([`a1544a8`](https://github.com/taskforcesh/bullmq/commit/a1544a8c0f29522cd33772b14f559969db852d1d))

## v0.5.4 (2023-06-14)

### Fix

- **connection:** Add retry strategy in connection ([#1975](https://github.com/taskforcesh/bullmq/issues/1975)) ([`7c5ee20`](https://github.com/taskforcesh/bullmq/commit/7c5ee20471b989d297c8c5e87a6ea497a2077ae6))

## v0.5.3 (2023-06-13)

### Fix

- **worker:** Use timeout as integer for redis lower than v6.0.0 (python) ([#1981](https://github.com/taskforcesh/bullmq/issues/1981)) ([`0df6afa`](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb))

## v0.5.2 (2023-06-11)

### Fix

- **retry-job:** Consider priority when moving job to wait (python) ([#1969](https://github.com/taskforcesh/bullmq/issues/1969)) ([`e753855`](https://github.com/taskforcesh/bullmq/commit/e753855eef248da73a5e9f6b18f4b79319dc2f86))

## v0.5.1 (2023-06-09)

### Fix

- **python:** Include lua scripts when releasing ([`bb4f3b2`](https://github.com/taskforcesh/bullmq/commit/bb4f3b2be8e3d5a54a87f0f5d6ba8dfa09900e53))

## v0.5.0 (2023-06-09)

### Feature

- **python:** Add remove job method ([#1965](https://github.com/taskforcesh/bullmq/issues/1965)) ([`6a172e9`](https://github.com/taskforcesh/bullmq/commit/6a172e97e65684f65ee570c2ae9bcc108720d5df))

## v0.4.4 (2023-06-08)

### Fix

- **deps:** Downgrade python-semantic-release to avoid version issue

## v0.4.3 (2023-06-07)

### Feature

- Add changePriority method ([#1943](https://github.com/taskforcesh/bullmq/issues/1943)) ([`945bcd3`](https://github.com/taskforcesh/bullmq/commit/945bcd39db0f76ef6e9a513304714c120317c7f3))

### Fix

- **rate-limit:** Consider paused queue ([#1931](https://github.com/taskforcesh/bullmq/issues/1931)) ([`d97864a`](https://github.com/taskforcesh/bullmq/commit/d97864a550992aeb8673557c7d8f186ab4ccb5bf))

## v0.4.2 (2023-06-01)

### Fix

- **deps:** Fix 'install_requires' to include semver ([#1927](https://github.com/taskforcesh/bullmq/issues/1927)) ([`ce86ece`](https://github.com/taskforcesh/bullmq/commit/ce86eceed40283b5d3276968b65ceae31ce425bb))

## v0.4.1 (2023-05-29)

### Feature

- **job:** Add getState method ([#1906](https://github.com/taskforcesh/bullmq/issues/1906)) ([`f0867a6`](https://github.com/taskforcesh/bullmq/commit/f0867a679c75555fa764078481252110c1e7377f))

## [v0.4.0](https://github.com/taskforcesh/bullmq/compare/46d6f94...01b621f) (2023-05-18)

### Feature

- **connection:** accept redis options as string ([`01f549e`](https://github.com/taskforcesh/bullmq/commit/01f549e62a33619a7816758910a2d2b5ac75b589))
- **job:** add moveToDelayed job method ([#1849](https://github.com/taskforcesh/bullmq/issues/1849)) ([`5bebf8d`](https://github.com/taskforcesh/bullmq/commit/5bebf8d6560de78448b0413baaabd26f7227575c))
- **job:** Add retry method into job ([#1877](https://github.com/taskforcesh/bullmq/issues/1877)) ([`870da45`](https://github.com/taskforcesh/bullmq/commit/870da459f419076f03885a12a4ce5a2930c500f3))
- **job:** Add updateData method ([#1871](https://github.com/taskforcesh/bullmq/issues/1871)) ([`800b8c4`](https://github.com/taskforcesh/bullmq/commit/800b8c46e709a8cbc4674d84bd59d5c62251d271))
- **job:** Add updateProgress method in job class([#1830](https://github.com/taskforcesh/bullmq/issues/1830)) ([`e1e1aa2`](https://github.com/taskforcesh/bullmq/commit/e1e1aa2e7a41e5418a5a50af4cea347a38bbc7d1))
- **job:** Save stacktrace when job fails ([#1859](https://github.com/taskforcesh/bullmq/issues/1859)) ([`0b538ce`](https://github.com/taskforcesh/bullmq/commit/0b538cedf63c3f006838ee3d016e463ee3492f81))
- Support retryJob logic ([#1869](https://github.com/taskforcesh/bullmq/issues/1869)) ([`b044a03`](https://github.com/taskforcesh/bullmq/commit/b044a03159bc3a8d8823c71019f64825f318a6c2))

### Fix

- **retry:** Consider when queue is paused ([#1880](https://github.com/taskforcesh/bullmq/issues/1880)) ([`01b621f`](https://github.com/taskforcesh/bullmq/commit/01b621fea0cbdae602482ff61361c05646823223))
- **worker:** Stop processes when force stop ([#1837](https://github.com/taskforcesh/bullmq/issues/1837)) ([`514699c`](https://github.com/taskforcesh/bullmq/commit/514699cd8be96db2320bf0f85d4b6593809a09f1))

## [v0.3.0](https://github.com/taskforcesh/bullmq/compare/ca48163...46d6f94) (2023-04-18)

### Feature

- **queue:** Add getJobCounts method ([#1807](https://github.com/taskforcesh/bullmq/issues/1807)) ([`46d6f94`](https://github.com/taskforcesh/bullmq/commit/46d6f94575454fe2a32be0c5247f16d18739fe27))
- Improve worker concurrency ([#1809](https://github.com/taskforcesh/bullmq/issues/1809)) ([`ec7c49e`](https://github.com/taskforcesh/bullmq/commit/ec7c49e284fd1ecdd52b96197281247f5222ea34))

### Fix

- Correct condition so that the worker keeps processing jobs indefinitely ([#1800](https://github.com/taskforcesh/bullmq/issues/1800)) ([`ef0c5d6`](https://github.com/taskforcesh/bullmq/commit/ef0c5d6cae1dcbae607fa02da32d5236069f2339))
- Fix scripts typing on array2obj function ([#1786](https://github.com/taskforcesh/bullmq/issues/1786)) ([`134f6ab`](https://github.com/taskforcesh/bullmq/commit/134f6ab5f3219ddd7a421e61ace6bac72bb51e6d))
- Pass maxMetricsSize as empty string when it is not provided fixes ([#1754](https://github.com/taskforcesh/bullmq/issues/1754)) ([`6bda2b2`](https://github.com/taskforcesh/bullmq/commit/6bda2b24be38a78e5fcfc71ed2913f0150a41dfc))

## [v0.2.0](https://github.com/taskforcesh/bullmq/compare/a97b22f...ca48163) (2023-03-29)

### Feature

- Add trimEvents method ([#1695](https://github.com/taskforcesh/bullmq/issues/1695)) ([`ca48163`](https://github.com/taskforcesh/bullmq/commit/ca48163263b12a85533563485176c684e548df0b))
- **queue:** Add retryJobs method ([#1688](https://github.com/taskforcesh/bullmq/issues/1688)) ([`2745327`](https://github.com/taskforcesh/bullmq/commit/2745327c7a7080f72e8c265bae77429e597cb6d3))

## v0.1.0 (2023-02-15)

### Feature

- Initial python package ([`a97b22f`](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff))
