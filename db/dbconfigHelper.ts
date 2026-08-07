import mysql from "mysql2";
import * as dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../utils/.env") });
dotenv.config();

type DBF = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

const getEnv = (primary: string, fallback: string) => process.env[primary] || process.env[primary.toUpperCase()] || fallback;

const config: DBF = {
  host: getEnv("DB_HOST", getEnv("HOST", "localhost")),
  port: Number(getEnv("DB_PORT", getEnv("PORT", "3306"))) || 3306,
  user: getEnv("DB_USER", getEnv("USER", "root")),
  password: getEnv("DB_PASSWORD", getEnv("PASSWORD", "")),
  database: getEnv("DB_NAME", getEnv("DATABASE", "")),
};

const connect: mysql.Pool = mysql.createPool(config);
export default connect;