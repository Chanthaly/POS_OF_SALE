import connect from "../db/dbconfigHelper.js";

export const WaitTranstin = async (callback: (conn: any) => Promise<any>) => {
  const conn = await connect.promise().getConnection();

  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};