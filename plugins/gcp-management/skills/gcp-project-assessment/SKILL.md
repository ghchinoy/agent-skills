---
name: gcp-project-assessment
description: Audits, categorizes, and correlates Google Cloud & Firebase projects across billing accounts, active compute, 30-day traffic metrics, cost drivers, and Firebase services. Produces structured Markdown reports and actionable optimization recommendations.
---

# GCP & Firebase Project Assessment Skill

This skill provides an automated, parallelized workflow to analyze, categorize, and optimize Google Cloud Platform (GCP) and Firebase project portfolios.

It inspects billing accounts, active compute resources (Compute Engine, Cloud Run, App Engine, Cloud Functions, GKE, Cloud SQL), Cloud Storage buckets, Cloud Logging activity, and Firebase services (Firestore databases, Firebase Apps, Firebase Hosting domains).

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

## Step-by-Step Workflow

### Step 1: Discover Projects & Billing Links
1. Fetch all projects accessible to the user:
   ```bash
   gcloud projects list --format="json(projectId,name,projectNumber,createTime,lifecycleState)"
   ```
2. Query billing accounts and project billing details:
   ```bash
   gcloud billing accounts list --format="json"
   gcloud beta billing projects describe <PROJECT_ID> --format="json"
   ```
3. Classify projects into:
   - **Billing Enabled** (Linked to open billing account)
   - **Billing Disabled / Unlinked** ($0 cost, dormant)

---

### Step 2: Parallel Resource Scanning
Scan all projects concurrently (e.g., via `ThreadPoolExecutor` in Python) for active resources:
- **Compute Engine:** `gcloud compute instances list --project=<pid>` & `gcloud compute disks list --project=<pid>`
- **Cloud Run:** `gcloud run services list --project=<pid>`
- **App Engine:** `gcloud app services list --project=<pid>`
- **Cloud Functions:** `gcloud functions list --project=<pid>`
- **GKE Clusters:** `gcloud container clusters list --project=<pid>`
- **Cloud SQL:** `gcloud sql instances list --project=<pid>`
- **Cloud Storage:** `gcloud storage buckets list --project=<pid>`
- **Static IPs & Load Balancers:** `gcloud compute addresses list --project=<pid>`

---

### Step 3: Inspect 30-Day Traffic & Activity Logs
Do not rely solely on project creation date or resource lists. Differentiate actual user/API traffic from passive system audit logs using Cloud Logging:
1. **HTTP / Web Traffic Query:**
   ```bash
   gcloud logging read 'timestamp >= "YYYY-MM-DDT00:00:00Z" AND httpRequest.requestMethod:*' --project=<pid> --limit=20
   ```
2. **General Service Log Query:**
   ```bash
   gcloud logging read 'timestamp >= "YYYY-MM-DDT00:00:00Z"' --project=<pid> --limit=10
   ```
3. Categorize into:
   - **Active HTTP Traffic:** Ongoing user/API requests (Cloud Run, App Engine, Load Balancer, Functions).
   - **Active Scheduled Jobs:** Cloud Scheduler, Pub/Sub triggers, cron workflows.
   - **Data / Developer Activity:** Direct BigQuery queries, GCS object access, manual developer edits.
   - **Passive System Audit Logs:** Only automated Cloud Audit logs (`cloudaudit.googleapis.com`).

---

### Step 4: Correlate Firebase Services
Scan for integrated Firebase services across all projects:
1. **Firestore / Datastore Databases:**
   ```bash
   gcloud firestore databases list --project=<pid> --format="json"
   ```
2. **Firebase Registered Apps (Web, iOS, Android, macOS):**
   ```bash
   firebase apps:list --project=<pid> --json
   ```
3. **Firebase Hosting Domains & Custom Sites:**
   ```bash
   firebase hosting:sites:list --project=<pid> --json
   ```

---

### Step 5: Identify Cost Drivers & Optimization Quick-Wins
Analyze collected metadata to isolate cost drivers:
- **Running VM Instances:** Incur continuous hourly compute fees.
- **Orphaned Persistent Disks:** Disks attached to terminated/stopped VMs continue to incur monthly storage costs ($/GB).
- **Reserved Static IPs & Forwarding Rules:** Unused load balancer IP addresses incur hourly reservation fees.
- **Dormant Projects with Billing Enabled:** Zero compute, zero 30d traffic, but billing linked.

---

### Step 6: Generate the Audit Report
Write a Markdown report named `GCP_PROJECTS_AUDIT_REPORT.md` in the current working directory containing:
1. **Executive Summary:** High-level project counts, total billing-enabled vs disabled, active production hubs count.
2. **Immediate Cost Reduction & Quick Wins:** Stopped VMs, deleted orphaned disks, project consolidations.
3. **High-Priority Active Projects (In-Depth Analysis):** Cloud Run services, Firebase DBs, apps, domains, buckets.
4. **Firebase Services Correlation Matrix:** Comprehensive table linking projects to Firestore DBs, Apps, Hosting domains, and status.
5. **Master Inventory Categorization:**
   - *Category A:* Active Production & Workload Hubs
   - *Category B:* Deployed Services / Low or Zero Traffic (Consolidation Candidates)
   - *Category C:* Dormant Projects with Billing Enabled (Unlink Billing)
   - *Category D:* Billing Disabled / Unlinked Projects (Delete Candidates)
6. **Action Roadmap & Command Cheatsheet:** Exact `gcloud` commands to stop instances, delete disks, unlink billing, and delete projects.

---

## Cheatsheet of Common Remediation Commands

```bash
# Stop a running VM instance
gcloud compute instances stop <INSTANCE_NAME> --zone=<ZONE> --project=<PROJECT_ID>

# Delete orphaned persistent disks
gcloud compute disks delete <DISK_NAME> --zone=<ZONE> --project=<PROJECT_ID> --quiet

# Unlink billing from a dormant project
gcloud beta billing projects unlink <PROJECT_ID>

# Delete/shut down a retired project
gcloud projects delete <PROJECT_ID> --quiet
```
