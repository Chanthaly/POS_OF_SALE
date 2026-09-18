// middleware/checkCompanyActive.ts
import  type { Request,Response,NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { withTransaction } from "../dbconfig/configdb.js";

type CompanyStatusRow = RowDataPacket & {
  c_status: "active" | "inactive";
};

export const checkCompanyActive = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {

    const companyId = req.user?.company_id;
        
    if (!companyId) {
      return res.status(403).json({
        resultCode: 403,
        message: "Company not assigned"
      });
    }

    const [rows] = await withTransaction((connection) =>
      connection.query(
        `SELECT c_status FROM company WHERE company_id = ?`,
        [companyId]
      )
    ) as [CompanyStatusRow[], unknown];
    if (!rows.length) {
      return res.status(404).json({
        resultCode: 404,
        message: "Company not found"
      });
    }

    if (rows[0]?.c_status !== "active") {
      return res.status(403).json({
        resultCode: 403,
        message: "Company is inactive"
      });
    }

    next();

  } catch (error) {
    return res.status(500).json({
      resultCode: 500,
      message: "Server error"
    });
  }
};