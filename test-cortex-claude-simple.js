#!/usr/bin/env node

// Test Cortex with Claude 3 Haiku (older version) + Titan
require('dotenv').config();

// Use Claude 3 Haiku (older, no inference profile) + Titan
process.env.CORTEX_ENCODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_DECODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_CORE_MODEL = 'amazon.titan-text-express-v1';

async function testCortexClaudeSimple() {
  console.log('🧠 CORTEX TEST - CLAUDE 3 HAIKU + TITAN');
  console.log('- Encoder: Claude 3 Haiku (older)');
  console.log('- Decoder: Claude 3 Haiku (older)'); 
  console.log('- Core: Amazon Titan Express');
  console.log('\n' + '='.repeat(55) + '\n');

  try {
    const { cortexService } = require('./dist/services/cortexService');
    
    const testInput = 'Analyze financial data';
    console.log('📝 Testing:', testInput);
    console.log('-'.repeat(35));
    
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
      
      console.log('\n🎉 CORTEX IS WORKING WITH CLAUDE 3 HAIKU + TITAN!');
    } else {
      console.log('❌ FAILED');
      console.log('  Error:', result.error || 'Unknown error');
      console.log('  Metrics:', JSON.stringify(result.metrics, null, 2));
    }
    
  } catch (error) {
    console.log('❌ ERROR:', error.message);
    if (error.message.includes('pricing')) {
      console.log('\n💡 Need to rebuild: npm run build');
    }
  }
}

testCortexClaudeSimple().then(() => {
  console.log('\n✨ Test complete!');
}).catch(error => {
  console.error('💥 Fatal error:', error.message);
});





