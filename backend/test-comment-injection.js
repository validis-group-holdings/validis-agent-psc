const { Parser } = require('node-sql-parser');

const parser = new Parser();
const sql = 'SELECT * FROM users WHERE id = 1--';

try {
  const ast = parser.astify(sql, { database: 'TransactSQL' });
  console.log('Parsed AST for comment injection:');
  console.log(JSON.stringify(ast, null, 2));
} catch (error) {
  console.error('Parse error:', error.message);
}
