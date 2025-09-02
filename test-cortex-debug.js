#!/usr/bin/env node

// Debug Cortex configuration and test
require('dotenv').config();

// Force Cortex settings
process.env.CORTEX_ENABLED = 'true';
process.env.CORTEX_MODE = 'mandatory';
process.env.CORTEX_ENCODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_DECODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_CORE_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';

async function debugCortex() {
  console.log('🔍 CORTEX DEBUG TEST');
  console.log('\n📋 Environment Variables:');
  console.log('  CORTEX_ENABLED:', process.env.CORTEX_ENABLED);
  console.log('  CORTEX_MODE:', process.env.CORTEX_MODE);
  console.log('  CORTEX_ENCODER_MODEL:', process.env.CORTEX_ENCODER_MODEL);
  console.log('  CORTEX_DECODER_MODEL:', process.env.CORTEX_DECODER_MODEL);
  console.log('  CORTEX_CORE_MODEL:', process.env.CORTEX_CORE_MODEL);
  console.log('\n' + '='.repeat(60) + '\n');

  try {
    // Test 1: Direct Cortex Service
    console.log('1️⃣ Testing Cortex Service directly...');
    const { cortexService } = require('./dist/services/cortexService');
    
    const testPrompt = 'Please analyze this quarterly financial report data very carefully and thoroughly, making sure to examine each and every detail, and then provide me with a comprehensive summary that includes all the key findings, insights, recommendations, action items, and strategic implications for our business going forward in the next quarter and beyond';
    
    console.log('📝 Input prompt length:', testPrompt.length, 'chars');
    console.log('📝 Input preview:', testPrompt.substring(0, 100) + '...');
    
    const cortexResult = await cortexService.process(testPrompt);
    
    console.log('\n📊 Cortex Results:');
    console.log('  Optimized:', !!cortexResult.optimized);
    console.log('  Response length:', cortexResult.response?.length || 0, 'chars');
    console.log('  Token reduction:', (cortexResult.metrics.tokenReduction * 100).toFixed(1) + '%');
    console.log('  Cost savings:', (cortexResult.metrics.costSavings * 100).toFixed(1) + '%');
    console.log('  Model used:', cortexResult.metrics.modelUsed);
    console.log('  Processing time:', cortexResult.metrics.processingTime + 'ms');
    
    if (cortexResult.optimized) {
      console.log('\n✅ CORTEX IS WORKING DIRECTLY!');
      console.log('📝 Optimized preview:', cortexResult.response.substring(0, 100) + '...');
    } else {
      console.log('\n❌ Cortex failed directly');
    }
    
    // Test 2: API Test with longer prompt
    console.log('\n' + '='.repeat(60));
    console.log('\n2️⃣ Testing via API with longer prompt...');
    
    const axios = require('axios');
    
    const apiData = {
      prompt: testPrompt,
      service: "openai",
      model: "gpt-4",
      useCortex: true,
      options: {
        enableCortex: true,
        compressionLevel: "aggressive",
        targetReduction: 50,
        preserveIntent: true
      }
    };
    
    console.log('📡 Sending API request...');
    console.log('  Use Cortex:', apiData.useCortex);
    console.log('  Prompt length:', apiData.prompt.length, 'chars');
    
    const response = await axios.post('http://localhost:8000/api/optimizations', apiData, {
      timeout: 120000, // 2 minutes
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4NzkwYTEzYzM1MGVhMDljZGU3OWZiMSIsImVtYWlsIjoiYWJkdWx0cml2aWFsQGdtYWlsLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzU2MjA5NDg2LCJleHAiOjE3NTY4MTQyODZ9.8VnHszPUggyPW5vOU8Wozo08Ce22wGomFGa6xJFJIIc'
      }
    });
    
    if (response.data.success) {
      const data = response.data.data;
      console.log('\n📊 API Results:');
      console.log('  Original:', data.originalPrompt.length, 'chars');
      console.log('  Optimized:', data.optimizedPrompt.length, 'chars');
      console.log('  Improvement:', data.improvementPercentage + '%');
      console.log('  Cost saved:', data.costSaved);
      console.log('  Tokens saved:', data.tokensSaved);
      
      if (data.improvementPercentage > 0) {
        console.log('\n🎉 CORTEX IS WORKING VIA API!');
        console.log('📝 Optimized preview:', data.optimizedPrompt.substring(0, 100) + '...');
      } else {
        console.log('\n⚠️  No optimization via API - investigating...');
        
        // Check suggestions for Cortex usage
        if (data.suggestions && data.suggestions.length > 0) {
          console.log('\n📋 Suggestions:');
          data.suggestions.forEach((suggestion, i) => {
            console.log(`  ${i+1}. ${suggestion.type}: ${suggestion.description}`);
            console.log(`     Impact: ${suggestion.impact}, Implemented: ${suggestion.implemented}`);
          });
        }
      }
    }
    
  } catch (error) {
    console.log('\n❌ ERROR:', error.message);
    if (error.response) {
      console.log('  Status:', error.response.status);
      console.log('  Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

debugCortex().then(() => {
  console.log('\n✨ Debug complete!');
}).catch(error => {
  console.error('💥 Fatal error:', error.message);
});





