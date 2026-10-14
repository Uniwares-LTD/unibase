# Shared-infrastructure owner integration

The base's additive owner changes are implemented in the local checkout
`output/agentic-poc`. `agentic-poc.patch` retains the reviewable diff for a separate
checkout of `karpishe-experiments/agentic-poc`. Its base revision is
`f9763f28828ed0b8cf133eb9f11646835bacd4d4`. Nothing has been committed or published.

The package adds a public app-route registry, validator and manual registered-route
workflow. The existing canonical infrastructure script exports registered routes
to Terraform on every run. Terraform remains the sole tunnel/DNS writer and retains
existing Booklet, SSH and Dify routes. Shared reconciliation uses the existing
Infrastructure concurrency group and ownership/destructive-drift safeguards.

Apply/review the patch in the owner repository through its normal source workflow.
The provided app entries are disabled placeholders; fill reviewed hostnames and
existing tunnel/account/zone identifiers, verify port allocations, then enable the
entries. Configure the app's tracked `shared` settings to match the registry.
The calling token needs only owner Contents read and Actions read/write. Provider
administration/state credentials stay with the existing owner workflow.

Before publication, run the registry unit tests, actionlint, canonical-script Bash
syntax/ShellCheck, and validate/test both Terraform roots with pinned providers.
Terraform tests use mocks and plans; live Terraform apply and routing acceptance
remain separate. Check application DNS while preserving existing SSH access and
every hosted service during live acceptance.

Derived projects do not copy this installation-specific patch. After the owner
integration is installed, register each derived app's own repository, slug,
environment, hostname and port in a reviewed owner change. Explicit shared profiles
may reuse the owner connection, staging Firebase project and Atlas cluster, without
inheriting app identities or private credentials.

Follow-ups: transfer the shared tunnel's Terraform state, registry, credentials,
concurrency and all existing routes to a dedicated infrastructure owner; transfer
Dify Community lifecycle separately with its installation, credentials,
database/storage, backups and continuity. These are future handoffs, not automatic
provisioning or reinstallation steps.
