import type {Request, Response} from 'express'
import {serviceMessage } from '../utils/service.Message.js'
import WaitTransition from '../db/dbconfigHelper.js';
import type { RowDataPacket } from 'mysql2';
import  type { ResultSetHeader } from "mysql2";


export const getCompanys = async (
  req: Request,
  res: Response
) => {
  try {
    const { search } = req.query;

    let sql = `
    SELECT  *  FROM company

   
    `;

    const params: (string | number)[] = [];

    const isSuperuser = req.user?.user_role === 'superuser';
    if (!isSuperuser && !req.user?.company_id) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_COMPANY_NOT_ASSIGNED });
    }
    if (!isSuperuser) {
      sql += ` WHERE company_id = ?`;
      params.push(req.user!.company_id!);
    }

    // // Search username
    if (
      typeof search === 'string' &&
      search.trim() !== ''
    ) {
      sql += `${isSuperuser ? ' WHERE' : ' AND'} company_name LIKE ?`;
      params.push(`${search.trim()}%`);
    }

    sql += ` ORDER BY company_id  DESC`;

    const [rows] = await WaitTransition
      .promise()
      .query<RowDataPacket[]>(sql, params);
    if (typeof search === 'string' && search.trim() !== '' && !rows.length) {
      return res.status(404).json({
        resultCode: 404,
        message: serviceMessage.DATA_NOT_FOUND,
        data: [],
      });
    }
    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data: rows,
    });

  } catch (err) {
    console.error('Get users error:', err);

    return res.status(500).json({
      resultCode: 500,
      message: serviceMessage.SERVER_ERROR,
      error: err,
    });
  }
};
type  CompanyID  = {
  company_id: number,
}
 type Status = 'active' | 'inactive'
type CompanyData   = RowDataPacket  & {
   company_name: string,
   c_status:   Status,
    created_at: string,
    updated_at: string,
    company_logo: string | null,
     companyID: CompanyID
}
 export  const  getCompanyID = async (req:Request,res:Response) => {
     const {company_id} = req.params as unknown as CompanyID;
     if(!company_id)  {
        return res.status(400).json({
            resultCode:400,
            message:  serviceMessage.ID_NOT_FOUND
        })
     }
     try
     
     {


        const requesterCompanyId = req.user?.company_id;
        if (req.user?.user_role !== 'superuser' && (!requesterCompanyId || requesterCompanyId !== Number(company_id))) {
          return res.status(403).json({ resultCode: 403, message: serviceMessage.FORBIDDEN });
        }
        const [result] = await WaitTransition.promise().query<CompanyData[]>("SELECT * FROM company WHERE company_id = ?",[company_id]);
        if(!result || result.length <= 0) {
            return res.status(404).json({
                resultCode:404,
                message:serviceMessage.DATA_NOT_FOUND
            })
        } else {
            return res.status(200).json({
                resultCode:200,
                resultMessage: serviceMessage.SUCCESS,
                resultData: result[0]
            })
        }
     }
   catch(err)
   {
  return res.status(500).json({
    resultCode:500,
    message:serviceMessage.SERVER_ERROR, err
  })


   }
}
export const  AddCompanyDATA  = async (req:Request, res:Response) => {
const  { company_name,c_status,created_at }  = req.body as CompanyData;
// if(!company_name || !c_status || !created_at ) {
//   return res.status(402).json({
//     resultCode:402,
//     message: serviceMessage.DATA_NOT_EXIST 
//   })
// }
  
  try{

     const companyLogo = req.file ? `/uploads/${req.file.filename}` : null;
     const sql = `INSERT INTO company (company_name,c_status,created_at,company_logo) VALUES(?,?,?,?)`;
     const [data] = await WaitTransition.promise().query<ResultSetHeader>(sql, [
       company_name,
       c_status,
       created_at,
       companyLogo,
     ]);
     return res.status(201).json({
      resultCode:201,
      message:serviceMessage.OPERATION_SUCESS,
      company_logo: companyLogo,
      company_id: data.insertId,
     });

  }catch(err)
  {
    console.error("err=>",err)
   return res.status(500).json({
    resultCode:500,
    message:serviceMessage.SERVER_ERROR,err
   })
  }
}

export const EditCPN = async (req: Request, res: Response) => {
  const { company_id } = req.params as CompanyData;

  const {
    company_name,
    c_status,
    updated_at
  } = req.body as CompanyData;

  if (!company_id) {
    return res.status(402).json({
      resultCode: 402,
      message: serviceMessage.ID_NOT_FOUND
    });
  }

  if (!company_name || !c_status || !updated_at) {
    return res.status(401).json({
      resultCode: 402,
      message: serviceMessage.DATA_NOT_EXIST
    });
  }

  try {
    if (req.user?.user_role !== 'superuser' && Number(company_id) !== Number(req.user?.company_id)) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.FORBIDDEN });
    }
    const params: (string | number)[] = [
      company_name,
      c_status,
      updated_at,
    ];
    let sql = `
      UPDATE company
      SET COMPANY_NAME = ?,
          C_STATUS = ?,
          UPDATED_AT = ?
    `;
    if (req.file) {
      sql += ', COMPANY_LOGO = ?';
      params.push(`/uploads/${req.file.filename}`);
    }
    sql += ' WHERE COMPANY_ID = ?';
    params.push(company_id);

    const [data] = await WaitTransition
      .promise()
      .query<ResultSetHeader>(sql, params);

    if (data.affectedRows === 0) {
      return res.status(402).json({
        resultCode: 401,
        message: serviceMessage.OPERATION_FAILE
      });
    }

    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.OPERATION_SUCESS,
      ...(req.file ? { company_logo: `/uploads/${req.file.filename}` } : {}),
    });

  } catch (err) {
    console.error("err =>", err);

    return res.status(500).json({
      resultCode: 500,
      message: serviceMessage.SERVER_ERROR,
      err
    });
  }
};