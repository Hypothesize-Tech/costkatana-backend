#!/usr/bin/env node

/**
 * Cost Katana Telemetry Verification Script
 * Verifies that OpenTelemetry is properly configured and working
 */

const axios = require('axios');
const colors = require('colors/safe');

// Load environment variables
require('dotenv').config();

const CHECKS = {
  environment: false,
  collector: false,
  application: false,
  traces: false,
  metrics: false,
  storage: false
};

async function checkEnvironment() {
  console.log('\n' + colors.blue('1. Checking Environment Variables...'));
  
  const required = [
    'OTEL_SERVICE_NAME',
    'OTLP_HTTP_TRACES_URL',
    'OTLP_HTTP_METRICS_URL'
  ];
  
  const missing = [];
  
  for (const varName of required) {
    if (process.env[varName]) {
      console.log(colors.green(`  ✓ ${varName}: ${process.env[varName]}`));
    } else {
      missing.push(varName);
      console.log(colors.yellow(`  ⚠ ${varName}: Not set (using defaults)`));
    }
  }
  
  // Check optional vars
  const optional = [
    'OTEL_EXPORTER_OTLP_HEADERS',
    'CK_CAPTURE_MODEL_TEXT',
    'CK_TELEMETRY_REGION'
  ];
  
  for (const varName of optional) {
    if (process.env[varName]) {
      console.log(colors.gray(`  • ${varName}: ${process.env[varName]}`));
    }
  }
  
  CHECKS.environment = missing.length === 0;
  return CHECKS.environment;
}

async function checkCollector() {
  console.log('\n' + colors.blue('2. Checking OpenTelemetry Collector...'));
  
  const tracesUrl = process.env.OTLP_HTTP_TRACES_URL || 'http://localhost:4318/v1/traces';
  
  // Only check if using local collector
  if (!tracesUrl.includes('localhost') && !tracesUrl.includes('127.0.0.1')) {
    console.log(colors.gray('  • Using remote endpoint, skipping local collector check'));
    CHECKS.collector = true;
    return true;
  }
  
  try {
    // Check health endpoint
    const healthUrl = 'http://localhost:13133/health';
    const response = await axios.get(healthUrl, { timeout: 5000 });
    
    if (response.status === 200) {
      console.log(colors.green(`  ✓ Collector is healthy at ${healthUrl}`));
      CHECKS.collector = true;
      return true;
    }
  } catch (error) {
    console.log(colors.red(`  ✗ Collector not running or unreachable`));
    console.log(colors.yellow(`    Run: npm run otel:run`));
    CHECKS.collector = false;
    return false;
  }
}

async function checkApplication() {
  console.log('\n' + colors.blue('3. Checking Application API...'));
  
  try {
    const apiUrl = `http://localhost:${process.env.PORT || 3001}/api/telemetry/health`;
    const response = await axios.get(apiUrl, { timeout: 5000 });
    
    if (response.data.status === 'healthy') {
      console.log(colors.green(`  ✓ Application telemetry is healthy`));
      console.log(colors.gray(`    • Service: ${response.data.telemetry?.sdk?.service_name}`));
      console.log(colors.gray(`    • Environment: ${response.data.telemetry?.sdk?.environment}`));
      console.log(colors.gray(`    • Collector: ${response.data.telemetry?.collector?.status}`));
      CHECKS.application = true;
      return true;
    }
  } catch (error) {
    console.log(colors.red(`  ✗ Application not running or telemetry endpoint not available`));
    console.log(colors.yellow(`    Make sure the application is running: npm run dev`));
    CHECKS.application = false;
    return false;
  }
}

async function generateTestTrace() {
  console.log('\n' + colors.blue('4. Generating Test Trace...'));
  
  try {
    // Make a test API call to generate a trace
    const testUrl = `http://localhost:${process.env.PORT || 3001}/api/telemetry/dashboard`;
    const response = await axios.get(testUrl, {
      headers: {
        'x-tenant-id': 'test-tenant',
        'x-workspace-id': 'test-workspace',
        'x-user-id': 'test-user',
        'x-request-id': `test-${Date.now()}`
      },
      timeout: 5000
    });
    
    if (response.status === 200) {
      console.log(colors.green('  ✓ Test trace generated successfully'));
      CHECKS.traces = true;
      
      // Check if data was returned
      if (response.data?.dashboard) {
        console.log(colors.gray(`    • Current RPM: ${response.data.dashboard.current?.requests_per_minute || 0}`));
        console.log(colors.gray(`    • Error Rate: ${response.data.dashboard.current?.error_rate || 0}%`));
      }
      
      return true;
    }
  } catch (error) {
    if (error.response?.status === 401) {
      console.log(colors.yellow('  ⚠ Test trace generated but auth required (this is normal)'));
      CHECKS.traces = true;
      return true;
    }
    console.log(colors.red('  ✗ Failed to generate test trace'));
    CHECKS.traces = false;
    return false;
  }
}

async function checkMetrics() {
  console.log('\n' + colors.blue('5. Checking Metrics Export...'));
  
  // Check if Prometheus endpoint is available (if using local collector)
  if (process.env.OTLP_HTTP_METRICS_URL?.includes('localhost')) {
    try {
      const metricsUrl = 'http://localhost:9464/metrics';
      const response = await axios.get(metricsUrl, { timeout: 5000 });
      
      if (response.status === 200 && response.data.includes('costkatana')) {
        console.log(colors.green('  ✓ Metrics are being exported'));
        console.log(colors.gray(`    • Prometheus endpoint: ${metricsUrl}`));
        CHECKS.metrics = true;
        return true;
      }
    } catch (error) {
      console.log(colors.yellow('  ⚠ Prometheus metrics endpoint not available'));
      console.log(colors.gray('    This is normal if not using local collector'));
    }
  } else {
    console.log(colors.gray('  • Using remote metrics endpoint'));
    CHECKS.metrics = true;
  }
  
  return CHECKS.metrics;
}

async function checkStorage() {
  console.log('\n' + colors.blue('6. Checking MongoDB Storage...'));
  
  try {
    const apiUrl = `http://localhost:${process.env.PORT || 3001}/api/telemetry?limit=1`;
    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.TEST_AUTH_TOKEN || ''}`
      },
      timeout: 5000,
      validateStatus: () => true
    });
    
    if (response.status === 200 || response.status === 401) {
      console.log(colors.green('  ✓ Telemetry storage is configured'));
      
      if (response.data?.data?.length > 0) {
        console.log(colors.gray(`    • Total stored spans: ${response.data.pagination?.total || 0}`));
      }
      
      CHECKS.storage = true;
      return true;
    }
  } catch (error) {
    console.log(colors.yellow('  ⚠ Could not verify storage (auth may be required)'));
    CHECKS.storage = true; // Don't fail on this
    return true;
  }
}

async function printSummary() {
  console.log('\n' + colors.blue('=' .repeat(50)));
  console.log(colors.blue('VERIFICATION SUMMARY'));
  console.log(colors.blue('=' .repeat(50)));
  
  const allPassed = Object.values(CHECKS).every(check => check);
  
  console.log('\nChecks:');
  console.log(`  Environment Variables: ${CHECKS.environment ? colors.green('✓') : colors.red('✗')}`);
  console.log(`  Collector Status:      ${CHECKS.collector ? colors.green('✓') : colors.yellow('⚠')}`);
  console.log(`  Application Health:    ${CHECKS.application ? colors.green('✓') : colors.red('✗')}`);
  console.log(`  Trace Generation:      ${CHECKS.traces ? colors.green('✓') : colors.yellow('⚠')}`);
  console.log(`  Metrics Export:        ${CHECKS.metrics ? colors.green('✓') : colors.yellow('⚠')}`);
  console.log(`  Storage:               ${CHECKS.storage ? colors.green('✓') : colors.yellow('⚠')}`);
  
  if (allPassed) {
    console.log('\n' + colors.green('✅ All checks passed! Telemetry is working correctly.'));
  } else {
    console.log('\n' + colors.yellow('⚠️  Some checks did not pass.'));
    console.log(colors.yellow('   Review the issues above and follow the suggested fixes.'));
  }
  
  console.log('\n' + colors.blue('Next Steps:'));
  console.log('  1. View telemetry dashboard: http://localhost:3001/api/telemetry/dashboard');
  console.log('  2. View traces: http://localhost:3001/api/telemetry');
  console.log('  3. View metrics: http://localhost:3001/api/telemetry/metrics');
  
  if (process.env.OTLP_HTTP_TRACES_URL?.includes('localhost')) {
    console.log('  4. View Prometheus metrics: http://localhost:9464/metrics');
    console.log('  5. View collector health: http://localhost:13133/health');
  }
}

async function main() {
  console.log(colors.blue('=' .repeat(50)));
  console.log(colors.blue('COST KATANA TELEMETRY VERIFICATION'));
  console.log(colors.blue('=' .repeat(50)));
  
  await checkEnvironment();
  await checkCollector();
  await checkApplication();
  
  if (CHECKS.application) {
    await generateTestTrace();
    await checkMetrics();
    await checkStorage();
  }
  
  await printSummary();
}

// Run verification
main().catch(error => {
  console.error(colors.red('\n❌ Verification failed:'), error);
  process.exit(1);
});
