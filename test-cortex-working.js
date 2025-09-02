#!/usr/bin/env node

// Test Cortex with models that definitely work
require('dotenv').config();

// Use Claude 3 Haiku (older) that works on-demand
process.env.CORTEX_ENCODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_DECODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_CORE_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_ENABLED = 'true';

async function testCortexWorking() {
  console.log('🧠 CORTEX TEST - WORKING MODELS');
  console.log('- Encoder: Claude 3 Haiku (older)');
  console.log('- Decoder: Claude 3 Haiku (older)'); 
  console.log('- Core: Claude 3 Haiku (older)');
  console.log('\n' + '='.repeat(50) + '\n');

  try {
    const { cortexService } = require('./dist/services/cortexService');
    
    const testInput = 'Please analyze this quarterly financial report data very carefully and thoroughly, making sure to examine each and every detail, and then provide me with a comprehensive summary that includes all the key findings, insights, recommendations, action items, and strategic implications for our business going forward in the next quarter and beyond';
    
    console.log('📝 Testing with verbose prompt:');
    console.log('  Length:', testInput.length, 'chars');
    console.log('  Preview:', testInput.substring(0, 80) + '...');
    console.log('-'.repeat(50));
    
    const startTime = Date.now();
    const result = await cortexService.process(testInput);
    const endTime = Date.now();
    
    console.log('\n📊 RESULTS:');
    if (result.optimized) {
      console.log('✅ Cortex processed successfully');
      console.log('  Original length:', testInput.length, 'chars');
      console.log('  Optimized length:', result.optimized.length, 'chars');
      console.log('  Token reduction:', (result.metrics.tokenReduction * 100).toFixed(1) + '%');
      console.log('  Cost savings:', (result.metrics.costSavings * 100).toFixed(1) + '%');
      console.log('  Processing time:', endTime - startTime, 'ms');
      console.log('  Model used:', result.metrics.modelUsed);
      console.log('  Cache hit:', result.metrics.cacheHit);
      
      if (result.metrics.tokenReduction > 0) {
        console.log('\n🎉 CORTEX IS WORKING! Achieved optimization!');
        console.log('\n📝 Optimized prompt:');
        console.log('"' + result.optimized + '"');
      } else {
        console.log('\n⚠️  Cortex processed but no optimization achieved');
      }
    } else {
      console.log('❌ Cortex failed');
      console.log('  Error:', result.error || 'Unknown error');
      console.log('  Metrics:', JSON.stringify(result.metrics, null, 2));
    }
    
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    console.log('Stack:', error.stack);
  }
}

testCortexWorking().then(() => {
  console.log('\n✨ Test complete!');
}).catch(error => {
  console.error('💥 Fatal error:', error.message);
});

