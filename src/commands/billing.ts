import chalk from 'chalk';
import { computeUsageReport } from '../billing/usage.js';

export interface BillingUsageOptions {
  since?: string;
  format?: string;
}

export async function billingUsageCommand(opts: BillingUsageOptions = {}): Promise<void> {
  const report = await computeUsageReport({ since: opts.since });

  if (opts.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('Seats'));
  console.log(`  SCIM active users:              ${report.seats.scimActiveUsers}`);
  console.log(`  SCIM inactive users:            ${report.seats.scimInactiveUsers}`);
  console.log(`  Workspace role overrides:       ${report.seats.workspaceMembersWithRoleOverrides}`);
  if (report.seats.licensedSeats !== undefined) {
    console.log(`  Licensed seats:                 ${report.seats.licensedSeats} (${report.seats.licenceStatus})`);
  }
  console.log(chalk.dim(`  ${report.seats.note}`));

  console.log('');
  console.log(chalk.bold(`Activity (${report.activity.since} → ${report.activity.until})`));
  console.log(`  Workspaces:                     ${report.activity.workspaceCount}`);
  console.log(`  Active machine tokens:          ${report.activity.activeMachineTokens}`);
  console.log(`  Total events:                   ${report.activity.totalEvents}`);
  for (const [category, count] of Object.entries(report.activity.eventsByCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${category.padEnd(28)} ${count}`);
  }
  console.log('');
}
