import dotenv from 'dotenv';
dotenv.config();

console.log("=== ENV VAR STATUS ===");
console.log(`GOOGLE_TOKEN_ENCRYPTION_KEY: ${process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ? 'Present' : 'Missing'}`);
console.log(`JWT_SECRET: ${process.env.JWT_SECRET ? 'Present' : 'Missing'}`);
console.log(`BROWSERBASE_API_KEY: ${process.env.BROWSERBASE_API_KEY ? 'Present' : 'Missing'}`);
console.log(`SERPER_API_KEY: ${process.env.SERPER_API_KEY ? 'Present' : 'Missing'}`);
console.log(`PEXELS_API_KEY (Image API): ${process.env.PEXELS_API_KEY ? 'Present' : 'Missing'}`);
console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'Present' : 'Missing'}`);
