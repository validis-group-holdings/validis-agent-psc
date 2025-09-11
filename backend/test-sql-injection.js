const { Parser } = require('node-sql-parser');

const parser = new Parser();
const sql = "SELECT * FROM users WHERE username = 'admin' OR '1'='1'";

try {
  const ast = parser.astify(sql, { database: 'TransactSQL' });
  console.log('Parsed AST:');
  console.log(JSON.stringify(ast, null, 2));
} catch (error) {
  console.error('Parse error:', error.message);
}
