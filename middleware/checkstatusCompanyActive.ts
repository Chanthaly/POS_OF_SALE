// middleware/checkCompanyActive.ts
import  type { Request,Response,NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { withTransaction } from "../dbconfig/configdb.js";
import { serviceMessage } from "../utils/service.Message.js";

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
    const isSuperuser = req.user?.user_role === "superuser";

    if (isSuperuser) {
      return next();
    }

    if (!companyId) {
      return res.status(403).json({
        resultCode: 403,
        message: serviceMessage.COMPANY_NOT_ASSIGNED
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
        message: serviceMessage.COMPANY_NOT_FOUND
      });
    }

    if (rows[0]?.c_status !== "active") {
      return res.status(403).json({
        resultCode: 403,
        message: serviceMessage.COMPANY_INACTIVE
      });
    }

    next();

  } catch (error) {
    return res.status(500).json({
      resultCode: 500,
      message: serviceMessage.SERVER_ERROR_RESPONSE
    });
  }
};