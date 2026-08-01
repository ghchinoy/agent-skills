---
name: gcp-project-assessment
description: Audits, categorizes, and correlates Google Cloud & Firebase projects across billing accounts, active compute, 30-day traffic metrics, cost drivers, and Firebase services. Produces structured Markdown reports and actionable optimization recommendations.
---

# GCP & Firebase Project Assessment Skill

This skill provides an automated, parallelized workflow to analyze, categorize, and optimize Google Cloud Platform (GCP) and Firebase project portfolios.

It inspects billing accounts, active compute resources (Compute Engine, Cloud Run, App Engine, Cloud Functions, GKE, Cloud SQL), Cloud Storage buckets, Cloud Logging activity, and Firebase services (Firestore databases, Firebase Apps, Firebase Hosting domains).

---

## CRITICAL SAFETY MANDATE: READ-ONLY AUDIT & HUMAN EXECUTION

> **STRICT RULE FOR AGENT EXECUTION:**
> 1. The AI agent **MUST NOT** execute any mutable, modifying, or destructive commands against the user's Google Cloud infrastructure (e.g., `gcloud compute instances stop`, `gcloud compute disks delete`, `gcloud projects delete`, `gcloud beta billing projects unlink`).
> 2. All audit steps **MUST be strictly read-only** (`list`, `describe`, `read`).
> 3. Recommendations and remediation steps **MUST be formatted as copy-pasteable shell command blocks for human review and execution**.

---

## When to Use

Use this skill when:
- Evaluating a collection of Google Cloud / Firebase projects.
- Identifying cost drivers, running VMs, or orphaned resources (e.g., persistent disks on stopped VMs).
- Determining which projects are receiving active user or API traffic vs. background system activity.
- Planning project consolidations, billing unlinking, or project closures.
- Generating a formal portfolio audit report (`GCP_PROJECTS_AUDIT_REPORT.md`).

---

## Required Tools & Dependencies

Ensure the following local tools are available:
- `gcloud` CLI (authenticated with access to billing accounts and project viewer permissions)
- `firebase` CLI (`firebase --version`)
- `python3` (with standard library modules: `subprocess`, `json`, `concurrent.futures`, `datetime`)

---

## Bundled Audit Script (`scripts/audit_portfolio.py`)

The skill includes a dedicated, parallelized Python script located at `scripts/audit_portfolio.py`.

### Execution:
```bash
python3 scripts/audit_portfolio.py --output gcp_audit_results.json
```

This script:
1. Queries all accessible GCP projects and their billing account attachment states.
2. Concurrently scans billing-enabled projects for Compute VMs, Persistent Disks, Cloud Run services, App Engine apps, Cloud Functions, Storage buckets, and Static IPs.
3. Checks Cloud Logging for 30-day HTTP/API request activity.
4. Queries Firebase APIs for Firestore DBs, registered Firebase Apps, and Firebase Hosting domains.
5. Saves the full structured data to `gcp_audit_results.json` without modifying any infrastructure.

---

## Step-by-Step Skill Workflow

### Step 1: Execute Portfolio Audit
Run `python3 scripts/audit_portfolio.py --output gcp_audit_results.json` or perform equivalent read-only `gcloud` and `firebase` commands.

### Step 2: Categorize Projects
Analyze `gcp_audit_results.json` to group projects into four distinct categories:
- **Category A: Active Production & Workload Hubs** (Active HTTP/API traffic, scheduled jobs, production workloads).
- **Category B: Deployed Services / Low Traffic & Standby** (Deployed Cloud Run/Functions/Hosting with low or zero 30d traffic; consolidation candidates).
- **Category C: Dormant Projects with Billing Enabled** (Zero active compute, zero traffic, but billing linked; candidates for unlinking billing).
- **Category D: Billing Disabled / Unlinked Projects** ($0 cost; candidates for project deletion/cleanup).

### Step 3: Identify Cost Drivers & Quick Wins
Isolate infrastructure incurring costs or risk:
- **Running VMs:** Incurring hourly compute costs.
- **Orphaned Persistent Disks:** Disks attached to terminated/stopped VMs continue to incur monthly storage costs ($/GB).
- **Unassigned Static IPs / Load Balancers:** Incurring hourly reservation fees.
- **Dormant Projects with Billing Linked:** Risk of unexpected background charges.

### Step 4: Generate the Audit Report
Write a Markdown report named `GCP_PROJECTS_AUDIT_REPORT.md` in the current working directory containing:
1. **Executive Summary & Progress Update:** High-level project counts, billing-enabled vs unlinked, running VM count.
2. **Immediate Cost Reduction & Quick-Win Recommendations:** Clear explanations of cost drivers.
3. **High-Priority Active Projects (In-Depth Audit):** Cloud Run services, Firebase DBs, apps, domains, buckets.
4. **Firebase Services Correlation Matrix:** Comprehensive table linking projects to Firestore DBs, Apps, Hosting domains, and status.
5. **Master Categorization:** Structured list of all projects under Categories A, B, C, and D.
6. **Human Action Roadmap & Command Cheatsheet:** Copy-pasteable `gcloud` command blocks for the human operator to review and execute.

---

## Human Remediation Commands (Provide to User - Do Not Execute)

```bash
# 1. Stop a running VM instance
gcloud compute instances stop <INSTANCE_NAME> --zone=<ZONE> --project=<PROJECT_ID>

# 2. Delete orphaned persistent disks
gcloud compute disks delete <DISK_NAME> --zone=<ZONE> --project=<PROJECT_ID> --quiet

# 3. Unlink billing from a dormant project
gcloud beta billing projects unlink <PROJECT_ID>

# 4. Delete/shut down a retired project
gcloud projects delete <PROJECT_ID> --quiet
```
