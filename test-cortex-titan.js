#!/usr/bin/env node

// Test Cortex with Nova Pro for encoding/decoding and Titan for core processing
require('dotenv').config();

// Use Nova Pro for encoding/decoding, Titan for core (no inference profile needed)
process.env.CORTEX_ENCODER_MODEL = 'amazon.nova-pro-v1:0';
process.env.CORTEX_DECODER_MODEL = 'amazon.nova-pro-v1:0';
process.env.CORTEX_CORE_MODEL = 'amazon.titan-text-express-v1';

async function testCortexWithTitan() {
  console.log('🧠 CORTEX TEST - NOVA + TITAN');
  console.log('- Encoder: Nova Pro');
  console.log('- Decoder: Nova Pro'); 
  console.log('- Core: Amazon Titan Express');
  console.log('\n' + '='.repeat(50) + '\n');

  try {
    const { cortexService } = require('./dist/services/cortexService');
    
    const testInput = 'Analyze financial data';
    console.log('📝 Testing:', testInput);
    console.log('-'.repeat(30));
    
    const startTime = Date.now();
    const result = await cortexService.process(testInput);
    const endTime = Date.now();
    
    if (result.optimized) {
      console.log('✅ SUCCESS!');
      console.log('  Original:', testInput.length, 'chars');
      console.log('  Optimized:', result.optimized.length, 'chars');
      console.log('  Token reduction:', (result.metrics.tokenReduction * 100).toFixed(1) + '%');
      console.log('  Cost savings:', (result.metrics.costSavings * 100).toFixed(1) + '%');
      console.log('  Processing time:', endTime - startTime, 'ms');
      console.log('  Model used:', result.metrics.modelUsed);
      
      if (result.metrics.cortexMetrics) {
        console.log('\n  Cortex Pipeline:');
        console.log('    Encoder:', result.metrics.cortexMetrics.encoderModel);
        console.log('    Core:', result.metrics.cortexMetrics.coreModel);
        console.log('    Decoder:', result.metrics.cortexMetrics.decoderModel);
      }
      
      console.log('\n🎉 CORTEX IS WORKING WITH NOVA + TITAN!');
    } else {
      console.log('❌ FAILED');
      console.log('  Error:', result.error || 'Unknown error');
      console.log('  Metrics:', JSON.stringify(result.metrics, null, 2));
    }
    
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    console.log('\nStack trace:', error.stack?.split('\n').slice(0, 3).join('\n'));
  }
}

testCortexWithTitan().then(() => {
  console.log('\n✨ Test complete!');
}).catch(error => {
  console.error('💥 Fatal error:', error.message);
});





