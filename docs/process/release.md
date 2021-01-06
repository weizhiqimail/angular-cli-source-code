# Setting Up Local Repository

1. Clone the Angular-CLI repo. A local copy works just fine.
1. Create an upstream remote:
  ```bash
  $ git remote add upstream https://github.com/angular/angular-cli.git
  ```

# Caretaker

The caretaker should triage issues, merge PR, and sheppard the release.

Caretaker calendar can be found [here](https://calendar.google.com/calendar/embed?src=angular.io_jf53juok1lhpm84hv6bo6fmgbc%40group.calendar.google.com&ctz=America%2FLos_Angeles).

Each shift consists of two caretakers. The primary caretaker is responsible for
merging PRs to master and patch whereas the secondary caretaker is responsible
for the release. Primary-secondary pairs are as follows:

Primary | Secondary
--------|----------
Alan    | Doug
Charles | Keen
Filipe  | Minko

## Triaging Issues
TBD

## Merging PRs

The list of PRs which are currently ready to merge (approved with passing status checks) can
be found with [this search](https://github.com/angular/angular-cli/pulls?q=is%3Apr+is%3Aopen+label%3A%22PR+action%3A+merge%22+-is%3Adraft).
This list should be checked daily and any ready PRs should be merged. For each PR, check the
`target` label to understand where it should be merged to.  You can find which branches a specific
PR will be merged into with the `yarn ng-dev pr check-target-branches <pr>` command.

When ready to merge a PR, run the following command:
```
yarn ng-dev pr merge <pr>
```


### Maintaining LTS branches

Releases that are under Long Term Support (LTS) are listed on [angular.io](https://angular.io/guide/releases#support-policy-and-schedule).

Since there could be more than one LTS branch at any one time, PR authors who want to
merge commits into LTS branches must open a pull request against the specific base branch they'd like to target.

In general, cherry picks for LTS should only be done if it meets one of the criteria below:

1. It addresses a critical security vulnerability.
2. It fixes a breaking change in the external environment.
   For example, this could happen if one of the dependencies is deleted from NPM.
3. It fixes a legitimate failure on CI for a particular LTS branch.

# Release

## Before releasing

Make sure the CI is green.

Consider if you need to update [`packages/schematics/angular/utility/latest-versions.ts`](https://github.com/angular/angular-cli/blob/master/packages/schematics/angular/utility/latest-versions.ts) to reflect changes in dependent versions.

## Shepparding

As commits are cherry-picked when PRs are merged, creating the release should be a matter of creating a tag.

Update the package versions to reflect the new release version in **both**:
1. [`package.json`](https://github.com/angular/angular-cli/blob/master/package.json#L3)
1. [`packages/schematics/angular/utility/latest-versions.ts`](https://github.com/angular/angular-cli/blob/master/packages/schematics/angular/utility/latest-versions.ts)

```bash
git commit -a -m 'release: vXX'
git tag -a 'vXX' -m 'release: tag vXX'
```

The package versions we are about to publish are derived from the git tag that
we just created. Double check that the versions are correct by running the
following command.

```bash
yarn admin packages --releaseCheck
```

Now push the commit and the tag to the upstream repository. **Make sure to use
`--follow-tags`, as tags need to be pushed immediately or CI may fail!**

```bash
git push upstream --follow-tags
```

### Authenticating

**This can ONLY be done by a Google employee.**

Log in to the Wombat publishing service using your own github and google.com
account to publish.  This enforces the loging is done using 2Factor auth.

Run `npm login --registry https://wombat-dressing-room.appspot.com`:

1. In the new browser tab, the registry app will ask you to connect with GitHub to create a token
1. After connecting with github, you will be redirected to create a token
1. Upon redirect, an auth token is added to your ~/.npmrc for the proxy

After closing the tab, you have successfully logged in, it is time to publish.

**NOTE: After publishing, remove the token added to your `~/.npmrc` file to logout.**

### Publishing

**This can ONLY be done by a Google employee.**

**It is a good idea to wait for CI to be green on the patch branch and tag before doing the release.**

For the first release of a major version, follow the instructions in
[Publishing a Major Version](#publishing-a-major-version) section.

For non-major release, check out the patch branch (e.g. `9.1.x`), then run:
```bash
rm -rf node_modules/ && yarn # Reload dependencies
yarn admin publish --tag latest
```

If also publishing a prerelease, check out `master`, then run:
```bash
rm -rf node_modules/ && yarn # Reload dependencies
yarn admin publish --tag next
```

If also publish an LTS branch, check out that patch branch (e.g. `8.3.x`), then
run:

**Make sure to update the NPM tag for the version you are releasing!**

```bash
rm -rf node_modules/ && yarn # Reload dependencies
yarn admin publish --tag v8-lts
```

### Release Notes

`yarn run -s admin changelog` takes `from` and `to` arguments which are any valid git
ref.

For example, running the following command will output the release notes on
stdout between v1.2.3 and 1.2.4:

```bash
yarn run -s admin changelog --from=v1.2.3 --to=v1.2.4
```

Copy the output (you can use `| pbcopy` on MacOS or `| xclip` on Linux) and
paste the release notes on [GitHub](https://github.com/angular/angular-cli/releases)
for the tag just released.

If you have an API token for GitHub you can create a draft automatically by
using the `--githubToken` flag. You just then have to confirm the draft.

> **Tags containing `next` or `rc` should be marked as pre-release.**

### Microsite Publishing

The [microsite](https://cli.angular.io/) is the landing page for Angular CLI and
is a one-page static page.

> **This can ONLY be done by a Google employee.**
>
> **You will need firebase access to our cli-angular-io firebase site. If you don't have it, escalate.**

Check out if changes were made to the microsite:

```sh
git log v8.0.0-beta.0..HEAD --oneline etc/cli.angular.io | wc -l
```

If the number is 0 you can ignore the rest of this section.

To publish, go to the
[`angular-cli/etc/cli.angular.io`](https://github.com/angular/angular-cli/tree/master/etc/cli.angular.io)
directory and run `firebase deploy`. You might have to `firebase login` first.
If you don't have the firebase CLI installed, you can install it using
`npm install --global firebase-tools` (or use your package manager of choice).

This is detailed in [`etc/cli.angular.io/README.md`](https://github.com/angular/angular-cli/blob/master/etc/cli.angular.io/README.md).

## Publishing a Major Version

For the first release of a major version, say `v10.0.0`, checkout the major branch
(i.e. `10.0.x`), then run:

```bash
yarn # Reload dependencies
yarn admin publish --tag next # a major release is always tagged as next initially
```

Confirm with downstream repositories (Components, etc) that everything is ok.
Once the release is stable, wait for Framework to retag their packages, then
retag the CLI packages as `latest`.
The command below will automatically retag stable packages as well as experimental
packages.

```bash
yarn admin dist-tag --version 10.0.0 --tag latest
```
