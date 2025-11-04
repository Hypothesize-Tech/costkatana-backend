#!/usr/bin/env node

// Test Cortex via API with proper model configuration
require('dotenv').config();

// Override models to use Claude 3 Haiku
process.env.CORTEX_ENCODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_DECODER_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_CORE_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
process.env.CORTEX_ENABLED = 'true';

async function testAPICortex() {
  console.log('🚀 TESTING CORTEX VIA API');
  console.log('- Encoder: Claude 3 Haiku');
  console.log('- Decoder: Claude 3 Haiku'); 
  console.log('- Core: Claude 3 Haiku');
  console.log('\n' + '='.repeat(40) + '\n');

  try {
    const axios = require('axios');
    
    // Check if server is running first
    console.log('📡 Checking if server is running...');
    try {
      await axios.get('http://localhost:8000/health', { timeout: 5000 });
      console.log('✅ Server is running');
    } catch (error) {
      console.log('❌ Server not running. Please start with: npm start');
      return;
    }
    
    console.log('📡 Testing API endpoint...');
    
    const testData = {
      prompt: "Analyze financial data quickly and provide insights",
      service: "openai", // Required field
      model: "gpt-4", // Required field
      useCortex: true,
      options: {
        enableCortex: true,
        compressionLevel: "aggressive",
        targetReduction: 30,
        preserveIntent: true,
        suggestAlternatives: true
      }
    };
    
    console.log('📝 Sending request:');
    console.log('  Prompt:', testData.prompt);
    console.log('  Service:', testData.service);
    console.log('  Model:', testData.model);
    console.log('  Use Cortex:', testData.useCortex);
    console.log('  Options:', JSON.stringify(testData.options));
    console.log('-'.repeat(40));
    
    const response = await axios.post('http://localhost:8000/api/optimizations', testData, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4NzkwYTEzYzM1MGVhMDljZGU3OWZiMSIsImVtYWlsIjoiYWJkdWx0cml2aWFsQGdtYWlsLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzU2MjA5NDg2LCJleHAiOjE3NTY4MTQyODZ9.8VnHszPUggyPW5vOU8Wozo08Ce22wGomFGa6xJFJIIc'
      }
    });
    
    if (response.data.success) {
      const data = response.data.data;
      console.log('✅ API SUCCESS!');
      console.log('  Original prompt:', data.originalPrompt.length, 'chars');
      console.log('  Optimized prompt:', data.optimizedPrompt.length, 'chars');
      console.log('  Improvement:', data.improvementPercentage + '%');
      console.log('  Cost saved:', data.costSaved);
      console.log('  Tokens saved:', data.tokensSaved);
      
      if (data.metadata) {
        console.log('\n  Cortex Metadata:');
        console.log('    Analysis time:', data.metadata.analysisTime + 'ms');
        console.log('    Confidence:', (data.metadata.confidence * 100).toFixed(1) + '%');
        console.log('    Optimization type:', data.metadata.optimizationType);
      }
      
      if (data.improvementPercentage > 0) {
        console.log('\n🎉 CORTEX IS WORKING VIA API!');
      } else {
        console.log('\n⚠️  No optimization achieved - check Cortex configuration');
      }
    } else {
      console.log('❌ API returned error:', response.data.message);
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server not running. Start with: npm start');
    } else if (error.code === 'ECONNABORTED') {
      console.log('❌ Request timeout - server might be processing');
    } else if (error.response) {
      console.log('❌ API ERROR:', error.response.status, error.response.statusText);
      console.log('  Response data:', JSON.stringify(error.response.data, null, 2));
      console.log('  Request URL:', error.config.url);
      console.log('  Request method:', error.config.method);
      console.log('  Request data:', JSON.stringify(JSON.parse(error.config.data), null, 2));
    } else {
      console.log('❌ ERROR:', error.message);
    }
  }
}

testAPICortex().then(() => {
  console.log('\n✨ Test complete!');
}).catch(error => {
  console.error('💥 Fatal error:', error.message);
});
