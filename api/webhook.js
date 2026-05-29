import axios from 'axios';
import crypto from 'crypto';

// ====== 配置区（请替换成你自己的信息）======
const FEISHU_APP_ID = 'cli_aa938dcde7fc5bb4';
const FEISHU_APP_SECRET = 'FYoOKHCPlLT20xpXijgckduvyAKtKJHu';
const FEISHU_APP_TOKEN = 'WbDSbGHegac1bVsPG60ckQtunKf';
const FEISHU_TABLE_ID = 'tbl86Dz1Sb7nyA3m';

// 钉钉加签密钥（后续在钉钉后台获取）
const DINGTALK_SIGN_SECRET = '你的钉钉加签密钥'; 
// =========================================

// 获取飞书 tenant_access_token
async function getFeishuToken() {
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }
  );
  return res.data.tenant_access_token;
}

// 写入飞书多维表格
async function writeRecordToFeishu(isApproved, approveTime) {
  const token = await getFeishuToken();
  const fields = {
    // 注意：字段名必须和你飞表格中的【字段名】完全一致（区分大小写、空格）
    '审批是否通过': isApproved ? '是' : '否',
    '审批时间': approveTime, // 飞书多维表格支持 YYYY-MM-DD HH:mm 格式
  };

  try {
    const res = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('✅ 写入成功:', res.data);
    return { success: true };
  } catch (err) {
    console.error('❌ 写入失败:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// 验证钉钉签名（安全校验）
function verifyDingTalkSignature(timestamp, sign, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  const expectedSign = crypto
    .createHmac('sha256', secret)
    .update(stringToSign, 'utf8')
    .digest('base64');
  return sign === expectedSign;
}

// Vercel Serverless 函数入口
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { timestamp, sign, eventType, data } = req.body;

  // 1. 验证钉钉签名（防止伪造请求）
  if (!verifyDingTalkSignature(timestamp, sign, DINGTALK_SIGN_SECRET)) {
    console.log('❌ 签名验证失败');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // 2. 只处理审批实例变更事件
  if (eventType !== 'bpms_instance_change') {
    return res.status(200).json({ message: 'Ignored other event' });
  }

  const { status, finishTime } = data;

  // 3. 只处理“已完成”的审批
  if (status !== 'COMPLETED') {
    return res.status(200).json({ message: 'Approval not completed yet' });
  }

  // 4. 判断是否通过（钉钉：agree = 通过，refuse = 拒绝）
  const isApproved = data.result === 'agree';
  const approveTime = new Date(finishTime).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-'); // 转为 YYYY-MM-DD HH:mm:ss

  // 5. 写入飞书
  const result = await writeRecordToFeishu(isApproved, approveTime);

  res.status(200).json({
    message: 'Processed',
    approved: isApproved,
    time: approveTime,
    feishu_result: result,
  });
}
