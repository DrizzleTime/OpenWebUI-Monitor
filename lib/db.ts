import { Pool, PoolClient } from "pg";

// 构建数据库连接配置
const dbConfig = process.env.POSTGRES_URL
  ? {
      // 远程数据库配置
      connectionString: process.env.POSTGRES_URL,
      ssl: {
        rejectUnauthorized: false, // 允许自签名证书
      },
    }
  : {
      // 本地 Docker 数据库配置
      host: process.env.POSTGRES_HOST || "localhost",
      user: process.env.POSTGRES_USER || "postgres",
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE || "openwebui_monitor",
      ssl: false,
    };

// 创建连接池
export const pool = new Pool(dbConfig);

// 测试连接
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

export interface ModelPrice {
  id: string;
  name: string;
  input_price: number;
  output_price: number;
  updated_at: Date;
}

export interface UserUsageRecord {
  id: number;
  userId: number;
  nickname: string;
  useTime: Date;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  balanceAfter: number;
}

// 确保表存在
export async function ensureTablesExist() {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();

    // 首先创建 users 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        balance DECIMAL(16, 6) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 然后创建 model_prices 表
    await client.query(
      `
      CREATE TABLE IF NOT EXISTS model_prices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        input_price NUMERIC(10, 6) DEFAULT CAST($1 AS NUMERIC(10, 6)),
        output_price NUMERIC(10, 6) DEFAULT CAST($2 AS NUMERIC(10, 6)),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
      [
        parseFloat(process.env.DEFAULT_MODEL_INPUT_PRICE || "0.01"),
        parseFloat(process.env.DEFAULT_MODEL_OUTPUT_PRICE || "0.03"),
      ]
    );

    // 最后创建 user_usage_records 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_usage_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        nickname VARCHAR(255) NOT NULL,
        use_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        model_name VARCHAR(255) NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost DECIMAL(10, 4) NOT NULL,
        balance_after DECIMAL(10, 4) NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    // console.log("确保所有表已创建");
  } catch (error) {
    console.error("Database connection/initialization error:", error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// 获取模型价格，如果不存在则创建默认值
export async function getOrCreateModelPrice(
  id: string,
  name: string
): Promise<ModelPrice> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query<ModelPrice>(
      `INSERT INTO model_prices (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = $2
       RETURNING *`,
      [id, name]
    );
    return result.rows[0];
  } catch (error) {
    console.error("Error in getOrCreateModelPrice:", error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// 更新模型价格
export async function updateModelPrice(
  id: string,
  input_price: number,
  output_price: number
): Promise<ModelPrice | null> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();

    // 使用 CAST 确保数据类型正确
    const result = await client.query<ModelPrice>(
      `UPDATE model_prices 
       SET 
         input_price = CAST($2 AS NUMERIC(10,6)),
         output_price = CAST($3 AS NUMERIC(10,6)),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, input_price, output_price]
    );

    if (result.rows[0]) {
      return {
        ...result.rows[0],
        input_price: Number(result.rows[0].input_price),
        output_price: Number(result.rows[0].output_price),
      };
    }
    return null;
  } catch (error) {
    console.error(`更新模型 ${id} 价格失败:`, error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// 添加一个初始化函数
export async function initDatabase() {
  try {
    await ensureTablesExist();
    // console.log("Database initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

// 获取用户列表
export async function getUsers(page: number = 1, pageSize: number = 20) {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const offset = (page - 1) * pageSize;

    const countResult = await client.query("SELECT COUNT(*) FROM users");
    const total = parseInt(countResult.rows[0].count);

    const result = await client.query(
      `SELECT id, email, name, role, balance
       FROM users
       ORDER BY id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    return {
      users: result.rows,
      total,
    };
  } catch (error) {
    console.error("Error in getUsers:", error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// 更新用户余额
export async function updateUserBalance(userId: string, balance: number) {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `UPDATE users
       SET balance = $2
       WHERE id = $1
       RETURNING id, email, balance`,
      [userId, balance]
    );

    return result.rows[0];
  } catch (error) {
    console.error("Error in updateUserBalance:", error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}
