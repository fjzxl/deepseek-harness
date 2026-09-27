/**
 * 内置图标包（0.18.0，roadmap T2-1）：统一线稿风格的内联 SVG 图标。
 *
 * 动机：icon-list 页型名不副实（历史上只是色圆 + 序号数字，页面上没有任何"图标"），
 * cards/timeline 节点同样只有抽象几何点。内置一套**代码自有**（自绘几何线稿，非逐行
 * 搬运任何 GPL 图标库）的图标词汇表，配合版式引擎确定性渲染：
 *   - 全部 24×24 viewBox、stroke-width=2、round cap/join、fill=none——一册内风格强制统一；
 *   - 图标不携带颜色：渲染时用锁定令牌色作为 stroke（HTML 内联 + PPTX 光栅化 PNG 双端一致）；
 *   - 不含 <text>（resvg 光栅化不依赖系统 CJK 字体）、不含外部引用（内网红线）。
 *
 * 选词：模型可在 content 里显式给 icon 名（icon-list.icons / cards[].icon / events[].icon），
 * 未给时按条目文本做确定性关键词匹配（pickIconForText），再无命中则按文本哈希落到
 * 中性图标池——同文本永远同图标（幂等），不同条目尽量不同图标。
 */

export interface IconDef {
  /** 图标名（kebab-case，content 里 icon 字段的取值） */
  name: string
  /** 24×24 viewBox 内的线稿标记（不含颜色/粗细——由渲染注入） */
  body: string
  /** 关键词（中文子串 + 英文单词，小写匹配） */
  keywords: string[]
}

const ICONS: IconDef[] = [
  { name: 'target', body: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', keywords: ['目标', '指标', 'kpi', '靶', '瞄准', '目的', '对标', 'target', 'okr'] },
  { name: 'rocket', body: '<path d="M12 2.5c2.8 1.9 4.5 5.5 4.5 9l-2.7 2.8h-3.6L7.5 11.5c0-3.5 1.7-7.1 4.5-9z"/><circle cx="12" cy="8.5" r="1.6"/><path d="M8.6 13.8L6.5 19l3.4-1.7M15.4 13.8l2.1 5.2-3.4-1.7M10.2 16.8h3.6"/>', keywords: ['启动', '发射', '上线', '发布', '启动会', '项目', 'rocket', 'launch', 'kickoff'] },
  { name: 'lightbulb', body: '<path d="M9 18.2h6M10.2 21h3.6"/><path d="M12 3a6 6 0 0 1 3.5 10.9c-.6.5-1 1.2-1 2v.3h-5v-.3c0-.8-.4-1.5-1-2A6 6 0 0 1 12 3z"/>', keywords: ['想法', '洞察', '创新', '灵感', '建议', '启发', '创意', '点子', 'idea', 'insight', 'innovation'] },
  { name: 'users', body: '<circle cx="8" cy="8" r="3.1"/><path d="M3 20c0-3.2 2.2-5.4 5-5.4s5 2.2 5 5.4"/><circle cx="17.8" cy="7.8" r="2.1"/><path d="M17.8 11.5c2.6.3 4.2 2.3 4.2 5.3"/>', keywords: ['团队', '人员', '组织', '员工', '队伍', '群体', '员工', 'user', 'team', 'staff', 'people'] },
  { name: 'user', body: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>', keywords: ['个人', '账户', '本人', '用户画像', 'user', 'account', 'profile'] },
  { name: 'chart-column', body: '<path d="M3 21h18"/><rect x="4.8" y="12.5" width="3.2" height="8.5" rx="0.5"/><rect x="10.4" y="8.5" width="3.2" height="12.5" rx="0.5"/><rect x="16" y="15" width="3.2" height="6" rx="0.5"/>', keywords: ['数据', '统计', '图表', '柱状', '对比数据', 'bar', 'chart', 'data', 'stat'] },
  { name: 'chart-line', body: '<path d="M3 21h18"/><polyline points="4,15.5 9,10.5 13,13.5 20,5.5"/><polyline points="15.5,5.5 20,5.5 20,10"/>', keywords: ['趋势', '走势', '曲线', '折线', '变化', 'line', 'trend', 'curve'] },
  { name: 'chart-pie', body: '<path d="M12 3a9 9 0 1 1-8.6 11.5L12 12z"/><path d="M12 12l6.8-4"/>', keywords: ['占比', '份额', '比例图', '饼图', '构成', 'pie', 'share', 'proportion'] },
  { name: 'trending-up', body: '<polyline points="3,17 9,11 13,15 21,7"/><polyline points="15,7 21,7 21,13"/>', keywords: ['增长', '上升', '提升', '上涨', '增益', 'up', 'growth', 'increase', 'gain'] },
  { name: 'trending-down', body: '<polyline points="3,7 9,13 13,9 21,17"/><polyline points="15,17 21,17 21,11"/>', keywords: ['下降', '回落', '下跌', '降低', '衰减', 'down', 'decline', 'decrease', 'drop'] },
  { name: 'check', body: '<polyline points="4,12.5 10,18.5 20,6.5"/>', keywords: ['完成', '通过', '达成', '就绪', '正确', 'done', 'ok', 'pass', 'complete'] },
  { name: 'check-circle', body: '<circle cx="12" cy="12" r="9"/><polyline points="8,12.2 11,15 16.5,9"/>', keywords: ['验收', '合格', '成功', '确认', '达成率', 'success', 'verified', 'pass'] },
  { name: 'warning', body: '<path d="M12 3.5L22 20H2z"/><line x1="12" y1="10" x2="12" y2="14.5"/><line x1="12" y1="17" x2="12" y2="17.4"/>', keywords: ['风险', '注意', '告警', '警告', '隐患', '预警', 'warning', 'risk', 'alert', 'caution'] },
  { name: 'info', body: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><line x1="12" y1="7.6" x2="12" y2="8"/>', keywords: ['说明', '提示', '须知', '备注', '注', 'info', 'note', 'tip'] },
  { name: 'question', body: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.8.3-.9 1-.9 1.7"/><line x1="12" y1="16.3" x2="12" y2="16.7"/>', keywords: ['疑问', '问题', '困惑', '挑战', '难题', 'question', 'issue', 'problem', 'faq'] },
  { name: 'gear', body: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.2v3.4M12 18.4v3.4M2.2 12h3.4M18.4 12h3.4M5.1 5.1l2.4 2.4M16.5 16.5l2.4 2.4M18.9 5.1l-2.4 2.4M7.5 16.5l-2.4 2.4"/>', keywords: ['设置', '配置', '机制', '参数', '系统设置', 'gear', 'setting', 'config'] },
  { name: 'wrench', body: '<path d="M20.5 6.8a5 5 0 0 1-6.3 6.1L7 20.1a2.1 2.1 0 0 1-3-3l7.2-7.2a5 5 0 0 1 6.1-6.3l-3 3 .8 2.4 2.4.8z"/>', keywords: ['工具', '维护', '修复', '运维', '检修', 'tool', 'fix', 'maintain', 'repair'] },
  { name: 'cloud', body: '<path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 8.3 4 4 0 0 1 17.5 18z"/>', keywords: ['云', '云端', '云服务', '云计算', 'cloud', 'saas'] },
  { name: 'database', body: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/><path d="M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/>', keywords: ['数据库', '存储', '数据资产', '库表', 'database', 'storage', 'db'] },
  { name: 'server', body: '<rect x="3" y="4" width="18" height="6.2" rx="1.5"/><rect x="3" y="13.8" width="18" height="6.2" rx="1.5"/><line x1="6.8" y1="7.1" x2="6.9" y2="7.1"/><line x1="6.8" y1="16.9" x2="6.9" y2="16.9"/><path d="M10.5 7.1h7M10.5 16.9h7"/>', keywords: ['服务器', '主机', '机房', '节点机', 'server', 'host', 'machine'] },
  { name: 'shield', body: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 7.6-7.5 9.5-4.3-1.9-7.5-4.9-7.5-9.5V6z"/>', keywords: ['安全', '保障', '防护', '风控', '防御', '信息安全', 'shield', 'security', 'protect', 'defense'] },
  { name: 'lock', body: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><line x1="12" y1="14" x2="12" y2="16.5"/>', keywords: ['锁定', '权限', '保密', '加密', '口令', 'lock', 'privacy', 'encrypt', 'permission'] },
  { name: 'key', body: '<circle cx="8" cy="14" r="4"/><path d="M10.8 11.2L20 2M16.5 5.5l2.5 2.5M13.8 8.2l2 2"/>', keywords: ['关键', '密钥', '要点钥匙', '核心', '关键点', 'key', 'core', 'keyword'] },
  { name: 'link', body: '<path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>', keywords: ['链接', '关联', '连接', '联动', '协同', '集成', 'link', 'connect', 'integrate'] },
  { name: 'globe', body: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/>', keywords: ['全球', '国际', '网络', '跨境', '全球版', 'globe', 'global', 'world', 'network'] },
  { name: 'map-pin', body: '<path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10z"/><circle cx="12" cy="10.5" r="2.3"/>', keywords: ['位置', '地点', '区域', '属地', '现场', '选址', 'location', 'site', 'region'] },
  { name: 'calendar', body: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="2.5" x2="8" y2="7"/><line x1="16" y1="2.5" x2="16" y2="7"/>', keywords: ['日程', '时间', '日期', '排期', '计划', 'calendar', 'schedule', 'date'] },
  { name: 'clock', body: '<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 15.5,14"/>', keywords: ['时长', '耗时', '周期', '工时', '时效', 'clock', 'time', 'duration', 'hour'] },
  { name: 'mail', body: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><polyline points="3.5,7 12,13 20.5,7"/>', keywords: ['邮件', '联系', '反馈', '信箱', '通知', 'mail', 'email', 'contact'] },
  { name: 'phone', body: '<path d="M5 3h4l1.5 4.5L8 9.5a12 12 0 0 0 6.5 6.5l2-2.5L21 15v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 3z"/>', keywords: ['电话', '热线', '客服', ' mobile', 'phone', 'hotline', 'call'] },
  { name: 'chat', body: '<path d="M21 12a8 8 0 0 1-8 8H4l1.8-3A8 8 0 1 1 21 12z"/><path d="M8.5 12h7"/>', keywords: ['对话', '沟通', '答疑', '访谈', '交流', 'chat', 'dialog', 'talk', 'qa'] },
  { name: 'book', body: '<path d="M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h14"/>', keywords: ['知识', '学习', '教材', '读书', '课程资料', 'book', 'knowledge', 'learn', 'study'] },
  { name: 'pen', body: '<path d="M14.5 4.5l5 5L8 21H3v-5z"/><path d="M12.5 6.5l5 5"/>', keywords: ['撰写', '编辑', '修订', '编写', '笔', 'edit', 'write', 'revise', 'draft'] },
  { name: 'search', body: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>', keywords: ['调研', '检索', '排查', '搜索', '分析', 'search', 'research', 'find'] },
  { name: 'filter', body: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>', keywords: ['筛选', '过滤', '分层筛选', '降噪', 'filter', 'funnel'] },
  { name: 'star', body: '<polygon points="12,3 14.7,8.9 21.2,9.6 16.3,13.9 17.8,20.3 12,16.9 6.2,20.3 7.7,13.9 2.8,9.6 9.3,8.9"/>', keywords: ['亮点', '优秀', '评分', '重点推荐', '星级', 'star', 'highlight', 'rating'] },
  { name: 'heart', body: '<path d="M12 20.5S3.5 15 3.5 9.3A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.5 2.9c0 5.7-8.5 11.2-8.5 11.2z"/>', keywords: ['关怀', '喜爱', '公益', '爱心', '满意度', 'heart', 'care', 'love'] },
  { name: 'award', body: '<circle cx="12" cy="9" r="5.5"/><polyline points="8.8,13.3 7.5,21 12,18.5 16.5,21 15.2,13.3"/>', keywords: ['荣誉', '表彰', '资质', '奖项', '勋章', 'award', 'honor', 'medal', 'prize'] },
  { name: 'trophy', body: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4a3 3 0 0 0 3.2 4M17 5h3A3 3 0 0 1 16.8 9"/><path d="M12 14v3M8.5 20.5h7M10 17h4v3.5h-4z"/>', keywords: ['奖杯', '夺冠', '成绩', '冠军', '胜利', 'trophy', 'win', 'champion', 'victory'] },
  { name: 'flag', body: '<path d="M5 21V4"/><path d="M5 5c2.5-1.5 5-1.5 7.5 0s5 1.5 6.5 0v9c-1.5 1.5-4 1.5-6.5 0S7.5 12.5 5 14"/>', keywords: ['里程碑', '标记', '旗帜', '节点', 'flag', 'milestone'] },
  { name: 'tag', body: '<path d="M3.5 12.5v-9h9L21 12l-8.5 8.5z"/><circle cx="8" cy="8" r="1.3"/>', keywords: ['标签', '分类', '专题', '词条', 'tag', 'label', 'category'] },
  { name: 'clipboard', body: '<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><polyline points="8.5,12 10.5,14 15,9"/>', keywords: ['清单', '任务', '检查表', '待办', '盘点', 'checklist', 'task', 'todo', 'inventory'] },
  { name: 'folder', body: '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', keywords: ['归档', '目录', '资料', '文档集', 'folder', 'archive'] },
  { name: 'file', body: '<path d="M6 2.5h8L19.5 8v13.5H6z"/><polyline points="13.5,2.5 13.5,8 19.5,8"/>', keywords: ['文档', '报告', '文件', '材料', 'file', 'document', 'report'] },
  { name: 'box', body: '<path d="M12 2.5l8.5 5v9L12 21.5 3.5 16.5v-9z"/><path d="M3.5 7.5l8.5 5 8.5-5M12 12.5v9"/>', keywords: ['产品', '交付', '封装', '制品', '物料', 'box', 'product', 'package', 'deliver'] },
  { name: 'cart', body: '<circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 3.5h3l2.5 12h9.5l2.5-8.5H7"/>', keywords: ['采购', '销售', '订单', '购物', 'cart', 'order', 'purchase', 'shop'] },
  { name: 'coin', body: '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="7.5" x2="12" y2="16.5"/><path d="M14.8 9.5c-.5-.8-1.6-1.3-2.8-1.3-1.7 0-3 .9-3 2.1 0 2.7 6 1.5 6 4.2 0 1.2-1.3 2.1-3 2.1-1.2 0-2.3-.5-2.8-1.3"/>', keywords: ['资金', '预算', '成本', '费用', '金额', 'money', 'cost', 'budget', 'fund'] },
  { name: 'wallet', body: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="17" height="12" rx="2"/><circle cx="16.5" cy="14" r="1.2"/>', keywords: ['财务', '经费', '营收', '收支', 'wallet', 'finance', 'revenue'] },
  { name: 'percent', body: '<line x1="5" y1="19" x2="19" y2="5"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>', keywords: ['比例', '百分比', '折扣', '率', 'percent', 'ratio', 'discount'] },
  { name: 'gift', body: '<rect x="3.5" y="8" width="17" height="4"/><rect x="5" y="12" width="14" height="8.5"/><path d="M12 8v12.5"/><path d="M12 8c-4 0-5-4-2.5-4S12 8 12 8zm0 0c4 0 5-4 2.5-4S12 8 12 8z"/>', keywords: ['福利', '礼包', '权益', '赠品', '优惠', 'gift', 'benefit', 'bonus'] },
  { name: 'zap', body: '<polygon points="13,2 4,14 11,14 10,22 20,9 13,9"/>', keywords: ['提速', '能效', '闪电', '快速', '高效', 'zap', 'fast', 'energy', 'efficiency'] },
  { name: 'cpu', body: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>', keywords: ['算力', '芯片', '处理器', '核心', 'cpu', 'chip', 'compute'] },
  { name: 'monitor', body: '<rect x="3" y="4" width="18" height="12.5" rx="1.5"/><path d="M9 20.5h6M12 16.5v4"/>', keywords: ['桌面', '终端', '大屏', '监控屏', 'monitor', 'desktop', 'screen'] },
  { name: 'smartphone', body: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/>', keywords: ['移动', '手机', '端', 'app', 'mobile', 'phone'] },
  { name: 'wifi', body: '<path d="M2.5 9.5a14 14 0 0 1 19 0M5.8 13a9.5 9.5 0 0 1 12.4 0M9 16.4a5 5 0 0 1 6 0"/><line x1="12" y1="19.3" x2="12" y2="19.7"/>', keywords: ['网络', '信号', '无线', '联网', 'wifi', 'wireless', 'signal'] },
  { name: 'code', body: '<polyline points="8,6 3,12 8,18"/><polyline points="16,6 21,12 16,18"/><line x1="13.5" y1="4" x2="10.5" y2="20"/>', keywords: ['开发', '代码', '研发', '编程', 'code', 'develop', 'dev'] },
  { name: 'terminal', body: '<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><polyline points="7,9.5 9.5,12 7,14.5"/><path d="M12.5 15h4"/>', keywords: ['命令', '脚本', '控制台', '命令行', 'terminal', 'cli', 'console'] },
  { name: 'git-branch', body: '<circle cx="6" cy="5.5" r="2.5"/><circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8v8"/><path d="M18 10.5c0 4-4.5 5.2-9 5.5"/>', keywords: ['分支', '版本', '迭代', '演进', 'branch', 'version', 'git'] },
  { name: 'layers', body: '<polygon points="12,3 22,8 12,13 2,8"/><polyline points="2,12.5 12,17.5 22,12.5"/><polyline points="2,17 12,22 22,17"/>', keywords: ['架构', '分层', '层级', '堆叠', 'layers', 'architecture', 'stack'] },
  { name: 'grid', body: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>', keywords: ['矩阵', '板块', '网格', '四象限', 'grid', 'matrix', 'module'] },
  { name: 'list', body: '<path d="M9 6h12M9 12h12M9 18h12"/><line x1="4.2" y1="6" x2="4.4" y2="6"/><line x1="4.2" y1="12" x2="4.4" y2="12"/><line x1="4.2" y1="18" x2="4.4" y2="18"/>', keywords: ['条目', '清单', '列表', '罗列', 'list', 'items'] },
  { name: 'eye', body: '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', keywords: ['观察', '监督', '审查', '监测', '洞察', 'eye', 'watch', 'monitor', 'observe'] },
  { name: 'thumbs-up', body: '<path d="M7 10.5v10H3.5v-10z"/><path d="M7 10.5l4-7.5c1.6 0 2.7 1.2 2.5 2.7L13 10h5.6a2 2 0 0 1 2 2.4l-1.4 6.3a2 2 0 0 1-2 1.6H7"/>', keywords: ['认可', '好评', '点赞', '满意度', '口碑', 'like', 'approve', 'praise'] },
  { name: 'refresh', body: '<path d="M20.5 8A8.5 8.5 0 1 0 21 13"/><polyline points="21,4 21,8.5 16.5,8.5"/>', keywords: ['更新', '迭代', '循环', '刷新', '重构', 'refresh', 'update', 'cycle', 'loop'] },
  { name: 'download', body: '<path d="M12 3v11"/><polyline points="7.5,10 12,14.5 16.5,10"/><path d="M4 17v2.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V17"/>', keywords: ['下载', '导入', '落地', '领取', 'download', 'import'] },
  { name: 'upload', body: '<path d="M12 14V3"/><polyline points="7.5,7.5 12,3 16.5,7.5"/><path d="M4 17v2.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V17"/>', keywords: ['上传', '提交', '上报', '报送', 'upload', 'submit', 'report'] },
  { name: 'share', body: '<circle cx="6" cy="12" r="2.8"/><circle cx="17.5" cy="5.5" r="2.8"/><circle cx="17.5" cy="18.5" r="2.8"/><line x1="8.5" y1="10.7" x2="15" y2="6.8"/><line x1="8.5" y1="13.3" x2="15" y2="17.2"/>', keywords: ['分享', '传播', '共享', '分发', 'share', 'spread', 'distribute'] },
  { name: 'play', body: '<circle cx="12" cy="12" r="9"/><polygon points="10,8.5 15.5,12 10,15.5"/>', keywords: ['播放', '演示', '放映', '直播', 'play', 'demo', 'video'] },
  { name: 'camera', body: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7l1.5-3h4l1.5 3"/><circle cx="12" cy="13.2" r="3.5"/>', keywords: ['拍摄', '影像', '记录', '照片', 'camera', 'photo', 'record'] },
  { name: 'image', body: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.8" cy="9.5" r="1.6"/><polyline points="4.5,17.5 10,12.5 13.5,16 16,14 20,17.5"/>', keywords: ['配图', '图像', '素材', '图片', 'image', 'picture', 'photo'] },
  { name: 'mic', body: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="18" x2="12" y2="21.5"/>', keywords: ['演讲', '发言', '音频', '主播', 'mic', 'audio', 'speech', 'voice'] },
  { name: 'home', body: '<path d="M4 11l8-7.5L20 11"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-6h4v6"/>', keywords: ['首页', '主页', '总部', '驻地', 'home', 'main', 'hq'] },
  { name: 'building', body: '<rect x="4" y="3.5" width="10" height="17"/><path d="M14 9.5h6V20.5"/><path d="M7 7.5h3.5M7 11h3.5M7 14.5h3.5M17 13h1.5M17 16.5h1.5"/><path d="M2.5 20.5h19"/>', keywords: ['企业', '机构', '园区', '楼宇', '单位', 'building', 'company', 'org'] },
  { name: 'factory', body: '<path d="M3 21V9l6 3.5V9l6 3.5V4h6v17z"/><line x1="7" y1="17" x2="7.2" y2="17"/><line x1="12" y1="17" x2="12.2" y2="17"/><line x1="17" y1="17" x2="17.2" y2="17"/>', keywords: ['制造', '生产', '工厂', '产线', 'factory', 'manufacture', 'production'] },
  { name: 'leaf', body: '<path d="M4 20C4 11 10 4.5 20 4c.5 10-6 16-14.5 16"/><path d="M4 20c3-6 7-9.5 12-11.5"/>', keywords: ['环保', '绿色', '可持续', '低碳', 'leaf', 'green', 'eco'] },
  { name: 'sun', body: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>', keywords: ['亮点', '白昼', '日照', '明', 'sun', 'bright'] },
  { name: 'moon', body: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>', keywords: ['夜间', '静默', '月', '夜间时段', 'moon', 'night'] },
  { name: 'compass', body: '<circle cx="12" cy="12" r="9"/><polygon points="15.5,8.5 13.5,13.5 8.5,15.5 10.5,10.5"/>', keywords: ['方向', '战略', '指引', '导航', '定位', 'compass', 'strategy', 'direction'] },
  { name: 'puzzle', body: '<path d="M10 3.5a1.8 1.8 0 0 1 3.6 0c0 .8-.5 1.2-.5 1.5h4.4v4.4c.3 0 .7-.5 1.5-.5a1.8 1.8 0 0 1 0 3.6c-.8 0-1.2-.5-1.5-.5v4.4h-4.4c0 .3.5.7.5 1.5a1.8 1.8 0 0 1-3.6 0c0-.8.5-1.2.5-1.5H5.5v-4.4c-.3 0-.7.5-1.5.5a1.8 1.8 0 0 1 0-3.6c.8 0 1.2.5 1.5.5V5h4.4c0-.3-.5-.7-.5-1.5z"/>', keywords: ['集成', '拼合', '协同配合', 'puzzle', 'integrate'] },
  { name: 'scale', body: '<path d="M12 3.5v17M8.5 20.5h7M4.5 7h15"/><path d="M4.5 7L2 13a3.2 3.2 0 0 0 5 0z"/><path d="M19.5 7L17 13a3.2 3.2 0 0 0 5 0z"/>', keywords: ['对比', '平衡', '权衡', '博弈', 'scale', 'balance', 'compare'] },
  { name: 'flame', body: '<path d="M12 2.5s1.2 3.2-1.3 5.7C8.3 10.6 7 12.2 7 14.5a5 5 0 0 0 10 0c0-4.2-5-12-5-12z"/><path d="M12 21a2.6 2.6 0 0 1-2.6-2.6c0-1.7 2.6-4 2.6-4s2.6 2.3 2.6 4A2.6 2.6 0 0 1 12 21z"/>', keywords: ['热度', '火爆', '燃烧', '热搜', 'flame', 'hot', 'trend'] },
  { name: 'bookmark', body: '<path d="M6.5 3.5h11V21L12 16.5 6.5 21z"/>', keywords: ['收藏', '关注', '订阅', '书签', 'bookmark', 'follow'] },
  { name: 'workflow', body: '<rect x="3" y="3.5" width="6.5" height="5.5" rx="1"/><rect x="14.5" y="15" width="6.5" height="5.5" rx="1"/><path d="M6.25 9v5a2 2 0 0 0 2 2h4.5"/><polyline points="11.5,13.5 14.5,16 11.5,18.5"/>', keywords: ['流程', '工作流', '编排', 'pipeline', 'workflow', 'flow'] },
]

/** 图标名 → 定义（导出供文档生成与单测遍历）。 */
export const ICON_DEFS: ReadonlyMap<string, IconDef> = new Map(ICONS.map(i => [i.name, i]))

export const ICON_NAMES: readonly string[] = ICONS.map(i => i.name)

/** 无关键词命中时的中性图标池（按文本哈希确定性选择，避免整页同图标）。 */
const GENERIC_ICONS: readonly string[] = ['check-circle', 'star', 'flag', 'bookmark', 'info', 'zap', 'target', 'compass']

export function isIconName(name: string): boolean {
  return ICON_DEFS.has(name)
}

/**
 * 渲染图标为完整 SVG（无固定宽高——HTML 端填满容器，PPTX 端按 viewBox 光栅化）。
 * stroke 颜色由调用方给（版式引擎用锁定令牌色）；线宽 2.4 比标准 2 粗一档——
 * 徽章内图标物理尺寸小（约 0.3in），视觉评估证明 2 在浅底上偏细。
 */
export function renderIconSvg(name: string, stroke: string): string {
  const def = ICON_DEFS.get(name) ?? ICON_DEFS.get('check-circle')!
  return (
    `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${stroke}" ` +
    `stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${def.body}</svg>`
  )
}

/** 稳定字符串哈希（FNV-1a 32 位）——同文本永远同选择。 */
function hashText(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * 按条目文本确定性选图标：关键词命中（长关键词权重更高）→ 中性池按哈希。
 * 返回值恒为合法图标名（词表内），不需要调用方兜底。
 */
export function pickIconForText(text: string): string {
  const lower = text.toLowerCase()
  let best = ''
  let bestScore = 0
  for (const icon of ICONS) {
    let score = 0
    for (const kw of icon.keywords) {
      if (lower.includes(kw.toLowerCase())) score += kw.length
    }
    if (score > bestScore) {
      best = icon.name
      bestScore = score
    }
  }
  if (bestScore > 0) return best
  return GENERIC_ICONS[hashText(text) % GENERIC_ICONS.length]!
}
