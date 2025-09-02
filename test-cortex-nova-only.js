#!/usr/bin/env node

// Test Cortex with Nova Pro for ALL components (encoder, decoder, core)
require('dotenv').config();

// Use Nova Pro for everything to avoid Claude inference profile issues
process.env.CORTEX_ENCODER_MODEL = 'amazon.nova-pro-v1:0';
process.env.CORTEX_DECODER_MODEL = 'amazon.nova-pro-v1:0';
process.env.CORTEX_CORE_MODEL = 'amazon.nova-pro-v1:0';

async function testCortexNovaOnly() {
  console.log('🧠 CORTEX TEST - NOVA PRO ONLY');
  console.log('- Encoder: Nova Pro');
  console.log('- Decoder: Nova Pro'); 
  console.log('- Core: Nova Pro');
  console.log('\n' + '='.repeat(50) + '\n');

  try {
    const { cortexService } = require('./dist/services/cortexService');
    
    const testInput = 'Analyze data';
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
      console.log('\n🎉 CORTEX IS WORKING WITH NOVA PRO!');
    } else {
      console.log('❌ FAILED');
      console.log('  Error:', result.error || 'Unknown error');
      console.log('  Metrics:', JSON.stringify(result.metrics, null, 2));
    }
    
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    if (error.message.includes('Malformed')) {
      console.log('\n💡 Nova Pro still has formatting issues with complex prompts');
      console.log('   Consider using Amazon Titan for core processing instead');
    }
  }
}

testCortexNovaOnly().then(() => {
  console.log('\n✨ Test complete!');
}).catch(error => {
  console.error('💥 Fatal error:', error.message);
});





