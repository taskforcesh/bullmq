# Contributing

## Commit messages

This package is using semantic-release to automate the release process, and this depends on a specific [format](https://github.com/angular/angular/blob/master/CONTRIBUTING.md#-commit-message-format) for commit messages. In case you are new using semantic-release or you just want a helper to make your commits, please run `yarn cm` to use `commitizen` to properly format your commit messages so they can be automatically processed and included in release notes.

## Pull request testing

Some notes on testing and releasing.

- For a PR, follow Github's command-line instructions for retrieving the branch with the changes.
- Please make sure that all test cases are passing by running:

```sh
yarn
yarn test
```

- Provide feedback on the PR about your changes and results.

## Start Redis

In case you don't have redis installed, there is a redis docker-compose for development purposes.

- Before starting Redis, make sure you have [docker-compose](https://docs.docker.com/compose/install/) installed.
- Now please follow [pull request testing](#pull-request-testing) section.

## Doing a release

Releases are automatically performed by semantic-release and consists on the following:

- update the version number in `package.json`
  - Fixes update the patch number, features update the minor number.
  - Major version update is reserved for API breaking changes, not just additions.
- `git add`, `git commit` and `git push` to get the version to master.
- update changelog following the commits format.
- `git tag -a 3.X.Y -m 3.X.Y` `git push --tags`
- `npm publish`
- add a version on the github release page, based on the tag.

So please, just follow the semantic-release commit format and don't change package.json version, this will be automatically changed.
