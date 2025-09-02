#!/usr/bin/env node
 
// Quick Cortex Test with Claude Core Model
require('dotenv').config();

// Override core model to use regular Claude instead of inference profile
process.env.CORTEX_CORE_MODEL = 'anthropic.claude-3-5-haiku-20241022-v1:0';

async function testCortexWithClaude() {
  console.log('🧠 CORTEX TEST WITH CLAUDE CORE');
  console.log('- Encoder:', process.env.CORTEX_ENCODER_MODEL || 'amazon.nova-pro-v1:0');
  console.log('- Decoder:', process.env.CORTEX_DECODER_MODEL || 'amazon.nova-pro-v1:0'); 
  console.log('- Core:', process.env.CORTEX_CORE_MODEL);
  console.log('\n' + '='.repeat(60) + '\n');

  try {
    const { cortexService } = require('./dist/services/cortexService');
    
    const testInput = 'Analyze financial data quickly';
    console.log('📝 Testing:', testInput);
    console.log('-'.repeat(40));
    
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
      console.log('\n🎉 CORTEX IS WORKING WITH CLAUDE!');
    } else {
      console.log('❌ FAILED');
      console.log('  Error:', result.error || 'Unknown error');
    }
    
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    if (error.message.includes('pricing')) {
      console.log('\n💡 TIP: Run "npm run build" to include pricing updates');
    }
  }
}

testCortexWithClaude().then(() => {
  console.log('\n✨ Test complete!');
}).catch(error => {
  console.error('💥 Fatal error:', error.message);
});







