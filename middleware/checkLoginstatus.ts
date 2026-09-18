
  import  type { Request, Response, NextFunction } from "express";
import { withTransaction } from "../dbconfig/configdb.js";

export const checkLoginCompanyActive = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { username, company_id: bodyCompanyId } = req.body;

    if (!username) {
      return res.status(401).json({
        resultCode: 401,
        message: "Username required"
      });
    }

    const companyId = bodyCompanyId === undefined || bodyCompanyId === null
      ? null
      : Number(bodyCompanyId);
    if (companyId !== null && (!Number.isInteger(companyId) || companyId <= 0)) {
      return res.status(400).json({
        resultCode: 400,
        message: "Invalid company_id"
      });
    }

    const [rows] = await withTransaction((connection) =>
      connection.query(
        `
        SELECT 
          u.role,
          u.company_id,
          c.c_status
        FROM users u
        LEFT JOIN company c
          ON c.company_id = u.company_id
        WHERE u.username = ?
        ${companyId === null ? '' : 'AND u.company_id = ?'}
        ORDER BY u.user_id DESC
        `,
        companyId === null ? [username] : [username, companyId]
      )
    ) as [any[], unknown];

    if (!rows.length) {
      return res.status(422).json({
        resultCode: 422,
        message: "User not found"
      });
    }

    const user = rows[0];

    if (user.role !== "superuser" && companyId === null) {
      return res.status(400).json({
        resultCode: 400,
        message: "company_id is required for company users"
      });
    }

    // superuser ຂ້າມ company check
    if (user.role === "superuser") {
      return next();
    }

    if (!user.company_id) {
      return res.status(403).json({
        resultCode: 403,
        message: "Company not assigned"
      });
    }

    if (user.c_status !== "active") {
      return res.status(403).json({
        resultCode: 403,
        message: "Company is inactive"
      });
    }

    next();

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      resultCode: 500,
      message: "Server error"
    });
  }
};