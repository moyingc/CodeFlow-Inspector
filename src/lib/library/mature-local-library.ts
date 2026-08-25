import type { LocalLibraryCategory, LocalLibraryStatus } from "@/src/lib/analysis/types";

export type MatureLibraryMaturity = "core" | "extended" | "planned";

export type MatureLibraryEntry = {
  id: string;
  category: LocalLibraryCategory;
  domain: string;
  name: string;
  maturity: MatureLibraryMaturity;
  signals: string[];
  evidenceFields: string[];
  appliesTo: string[];
  outputUse: string;
  gaps: string[];
};

export type MatureLibraryTarget = {
  category: LocalLibraryCategory;
  targetCount: number;
  coreDomains: string[];
  maturityGoal: string;
  next: string;
};

export type MatureLibraryAudit = {
  category: LocalLibraryCategory;
  entryCount: number;
  targetCount: number;
  coreCount: number;
  extendedCount: number;
  plannedCount: number;
  percent: number;
  status: LocalLibraryStatus;
  coveredDomains: string[];
  missingDomains: string[];
  next: string;
};

type EntrySeed = Omit<MatureLibraryEntry, "id" | "category">;

const categorySlug: Record<LocalLibraryCategory, string> = {
  数学模型库: "math",
  算法模型库: "algorithm",
  效率知识库: "efficiency",
  安全规则库: "security",
  稳定性规则库: "stability",
  语言生态库: "language",
  运行环境库: "runtime",
  电子元件参数库: "hardware",
  语义索引库: "semantic",
  工具适配器: "adapter",
};

export const localMatureLibraryTargets = {
  数学模型库: {
    category: "数学模型库",
    targetCount: 12,
    coreDomains: ["图论", "容量流量", "状态模型", "约束求解", "置信度"],
    maturityGoal: "覆盖水流法的可达性、容量、闭环、边界、置信度和异常传播公式。",
    next: "继续补真实项目上的容量压力分布、异常传播概率和图布局代价函数。",
  },
  算法模型库: {
    category: "算法模型库",
    targetCount: 16,
    coreDomains: ["图遍历", "路径搜索", "复杂度", "索引结构", "流式处理", "并发调度"],
    maturityGoal: "覆盖代码树、水系地图、流速控制和替代方案推荐所需的核心算法族。",
    next: "继续录入图布局、近似算法、增量分析和多目标优化的真实基准。",
  },
  效率知识库: {
    category: "效率知识库",
    targetCount: 14,
    coreDomains: ["时间复杂度", "内存", "I/O", "数据库", "缓存", "并发", "前端渲染"],
    maturityGoal: "能判断慢路径、容量压力、资源峰值和替代方案收益/稳定性代价。",
    next: "补真实 benchmark、DB explain 画像、运行时采样和不同规模输入曲线。",
  },
  安全规则库: {
    category: "安全规则库",
    targetCount: 20,
    coreDomains: ["污染流", "注入", "权限", "Web", "加密", "依赖", "隔离", "日志"],
    maturityGoal: "覆盖外部数据入侵、危险 sink、权限边界、依赖漏洞和敏感数据泄漏。",
    next: "补框架专用 source/sink、真实 CVE 版本窗和多租户样本。",
  },
  稳定性规则库: {
    category: "稳定性规则库",
    targetCount: 16,
    coreDomains: ["超时", "重试", "事务", "并发一致性", "资源释放", "边界", "降级", "设备稳定"],
    maturityGoal: "覆盖断流、满载、返流、闭环、竞态、异常吞掉和运行环境漂移。",
    next: "补真实故障样本、回放脚本和恢复策略验证结果。",
  },
  语言生态库: {
    category: "语言生态库",
    targetCount: 18,
    coreDomains: ["TypeScript", "Python", "Java", "C/C++", "Go", "Rust", "SQL", "Shell", "Web"],
    maturityGoal: "覆盖主流语言的标准库、类型系统、运行时风险、框架 API 和版本差异。",
    next: "补更多 SDK、框架版本矩阵、包管理器 lockfile 解析和危险 API 签名。",
  },
  运行环境库: {
    category: "运行环境库",
    targetCount: 8,
    coreDomains: ["Node", "Python", "JDK", "Go", "Rust", "Docker", "环境变量", "CI"],
    maturityGoal: "能检查运行载体、依赖、命令、配置、系统权限和复现条件缺失。",
    next: "补跨平台文件权限、服务依赖、容器资源限制和测试命令画像。",
  },
  电子元件参数库: {
    category: "电子元件参数库",
    targetCount: 8,
    coreDomains: ["GPIO", "UART", "I2C", "SPI", "ADC", "PWM", "执行器", "传感器"],
    maturityGoal: "为硬件代码提供电压、电流、采样率、容差、控制周期和保护策略。",
    next: "补具体器件 datasheet、驱动 SDK、板卡引脚映射和真实采样噪声数据。",
  },
  语义索引库: {
    category: "语义索引库",
    targetCount: 8,
    coreDomains: ["文件", "函数", "符号", "调用边", "水系节点", "水系边", "规则命中", "运行轨迹"],
    maturityGoal: "把项目扫描、函数图、水系图、规则证据和修复历史变成可查询本地数据库。",
    next: "接 sql.js/OPFS SQLite 的写入、增量更新、快照对比和 evidence_id 追溯。",
  },
  工具适配器: {
    category: "工具适配器",
    targetCount: 8,
    coreDomains: ["TypeScript Compiler", "Tree-sitter", "LSP", "Pyright", "gopls", "rust-analyzer", "clangd", "JDT LS"],
    maturityGoal: "把不同语言代码转成 AST、类型、引用、诊断和符号边供知识库判断。",
    next: "补 Tree-sitter WASM、LSP 后台服务、增量缓存和多解析器置信度融合。",
  },
} satisfies Record<LocalLibraryCategory, MatureLibraryTarget>;

function r(
  domain: string,
  name: string,
  maturity: MatureLibraryMaturity,
  signals: string[],
  evidenceFields: string[],
  appliesTo: string[],
  outputUse: string,
  gaps: string[] = [],
): EntrySeed {
  return { domain, name, maturity, signals, evidenceFields, appliesTo, outputUse, gaps };
}

const localMatureLibraryGroups: Record<LocalLibraryCategory, EntrySeed[]> = {
  数学模型库: [
    r("图论", "可达性闭合模型", "core", ["entry", "return", "unreachable", "path"], ["source", "target", "pathLength", "missingEdge"], ["代码树", "水系主河道"], "判断输入是否能沿函数路径到达输出。"),
    r("图论", "强连通分量模型", "core", ["cycle", "recursive", "back edge"], ["componentId", "cycleSize", "exitCount"], ["返流闭环", "递归"], "把返流和死循环从普通分支中分离。"),
    r("图论", "支配树模型", "core", ["must pass", "guard", "entry"], ["dominator", "dominatedNodes"], ["主控文件", "权限入口"], "判断某个验证函数是否支配危险 sink。"),
    r("容量流量", "最大流/最小割模型", "core", ["fanIn", "fanOut", "throughput"], ["capacity", "edgeVolume", "cutSet"], ["流速控制", "瓶颈定位"], "定位最小容量水段与扩容优先级。"),
    r("容量流量", "队列稳定模型", "core", ["queue", "producer", "consumer", "backpressure"], ["arrivalRate", "serviceRate", "bufferSize"], ["异步任务", "消息队列"], "判断输入增长是否会造成排队溢出。"),
    r("约束求解", "区间边界模型", "core", ["min", "max", "length", "limit", "overflow"], ["lowerBound", "upperBound", "unit"], ["数组", "分页", "传感器"], "检查越界、容量上限和单位边界。"),
    r("约束求解", "类型格/数据形态模型", "core", ["string", "number", "array", "object", "unknown"], ["inputType", "outputType", "narrowing"], ["水中元素", "函数签名"], "判断数据在节点间是否发生冲突或丢失。"),
    r("状态模型", "有限状态机模型", "core", ["state", "switch", "transition", "mode"], ["stateCount", "transition", "terminal"], ["简单业务流程", "设备控制"], "表达状态转移、终态缺失和非法跳转。"),
    r("状态模型", "马尔可夫风险传播", "extended", ["probability", "risk", "confidence"], ["transitionProbability", "riskWeight"], ["置信度", "异常传播"], "把局部低置信度传播到下游节点。", ["需要真实样本校准概率"]),
    r("置信度", "贝叶斯证据融合", "extended", ["regex", "ast", "type", "runtime"], ["prior", "likelihood", "posterior"], ["规则命中", "点击证据"], "融合多证据来源给出节点变色置信度。"),
    r("统计", "异常值与方差模型", "extended", ["latency", "memory", "spike", "outlier"], ["mean", "variance", "zScore"], ["性能基准", "Runtime Lab"], "识别输入规模变化造成的异常峰值。", ["需要更多 benchmark"]),
    r("单位", "维度/单位一致性模型", "extended", ["ms", "sec", "hz", "volt", "ma"], ["unit", "scale", "conversion"], ["电子元件", "时间参数"], "发现时间、电压、电流、频率单位混用。"),
  ],
  算法模型库: [
    r("图遍历", "BFS 层级遍历", "core", ["queue", "level", "neighbors"], ["visited", "depth", "parent"], ["代码树", "水系布局"], "按主控入口生成有序层级。"),
    r("图遍历", "DFS 路径探索", "core", ["recursive", "stack", "visited"], ["path", "backtrack", "cycle"], ["调用链", "闭环检测"], "追踪深层调用路径和返流。"),
    r("路径搜索", "Dijkstra/A* 路径评分", "extended", ["weight", "distance", "cost"], ["edgeWeight", "score", "heuristic"], ["最短风险路径", "地图布局"], "按风险和成本寻找关键路径。", ["需要真实权重校准"]),
    r("图遍历", "Tarjan SCC", "core", ["lowlink", "stack", "cycle"], ["component", "lowlink", "index"], ["递归", "闭环线路"], "检测函数循环依赖和稳定性风险。"),
    r("索引结构", "并查集", "core", ["union", "find", "component"], ["parent", "rank"], ["文件簇", "模块聚合"], "把多文件函数合并成可折叠流域。"),
    r("复杂度", "拓扑排序", "core", ["inDegree", "dag", "queue"], ["order", "blockedCycle"], ["主河道排序", "依赖构建"], "让数据从源头到输出按序渲染。"),
    r("索引结构", "哈希索引", "core", ["Map", "Set", "dict", "hash"], ["key", "lookupCount"], ["重复查找", "实体缓存"], "识别线性扫描可替代方案。"),
    r("索引结构", "Trie/前缀树", "extended", ["prefix", "startsWith", "route"], ["prefix", "terminal"], ["路由匹配", "命令解析"], "判断大量前缀匹配是否可优化。"),
    r("复杂度", "堆与 Top-K", "core", ["sort", "top", "priority"], ["k", "heapSize"], ["排行榜", "调度"], "避免全量排序造成无谓成本。"),
    r("复杂度", "二分查找", "core", ["sorted", "binary", "mid"], ["sortedEvidence", "bounds"], ["边界查找", "版本范围"], "判断有序数据的查找替代方案。"),
    r("复杂度", "动态规划", "extended", ["memo", "dp", "subproblem"], ["state", "transition", "cache"], ["规划计算", "重复递归"], "发现重复子问题和缓存机会。"),
    r("复杂度", "记忆化缓存", "core", ["cache", "memo", "ttl"], ["key", "ttl", "invalidator"], ["纯函数", "API 请求"], "为流速控制给出缓存收益与失效风险。"),
    r("流式处理", "分块/流式算法", "core", ["stream", "chunk", "reader"], ["chunkSize", "maxBytes"], ["大文件", "网络载荷"], "降低水库节点的内存容量压力。"),
    r("并发调度", "批处理算法", "core", ["batch", "bulk", "chunk"], ["batchSize", "flush"], ["数据库写入", "API 调用"], "平衡吞吐量和失败回滚范围。"),
    r("并发调度", "有界并发窗口", "core", ["Promise.all", "semaphore", "pool"], ["windowSize", "timeout"], ["网络请求", "任务队列"], "避免无限并发造成溢流。"),
    r("解析", "AST Visitor 模型", "core", ["node.kind", "visitor", "walk"], ["nodeKind", "scope", "symbol"], ["解析层", "规则证据"], "把函数、调用和类型从源码中稳定抽离。"),
  ],
  效率知识库: [
    r("时间复杂度", "Big-O 模式库", "core", ["loop", "nested", "recursive"], ["loopDepth", "inputScale"], ["所有语言"], "给函数容量和流速提供基础复杂度。"),
    r("数据库", "N+1 查询检测", "core", ["for", "query", "findMany", "select"], ["loop", "queryApi"], ["ORM", "SQL"], "识别循环中数据库访问。"),
    r("数据库", "索引选择性模型", "extended", ["where", "orderBy", "index"], ["predicate", "cardinality"], ["SQL", "ORM"], "判断是否需要索引或复合索引。", ["需要 explain 数据"]),
    r("数据库", "分页/游标模型", "core", ["limit", "offset", "cursor", "take"], ["limit", "cursor"], ["列表接口", "批任务"], "避免全量读取导致水库过载。"),
    r("缓存", "缓存命中与 TTL", "core", ["cache", "ttl", "expires"], ["key", "ttl", "hitRate"], ["纯计算", "HTTP"], "判断缓存收益和过期一致性风险。"),
    r("内存", "对象分配/GC 压力", "extended", ["map", "reduce", "new", "clone"], ["allocationCount", "payloadSize"], ["JS", "Java", "Python"], "发现热路径中不必要的对象复制。"),
    r("I/O", "文件/网络流式读取", "core", ["readFile", "json", "stream"], ["payloadSize", "chunk"], ["Node", "Python"], "把大输入拆成溪流而不是湖泊满载。"),
    r("序列化", "JSON 序列化成本", "extended", ["JSON.stringify", "json.dumps", "parse"], ["payloadSize", "schema"], ["API", "日志"], "识别重复序列化和大对象复制。"),
    r("并发", "异步阻塞与 await in loop", "core", ["await", "for", "sleep"], ["loop", "dependency"], ["JS", "Python"], "区分必须顺序和可批量并发的水路。"),
    r("并发", "背压与限流", "core", ["rateLimit", "queue", "backpressure"], ["window", "retryAfter"], ["HTTP", "消息队列"], "防止生产者压垮下游消费者。"),
    r("前端渲染", "渲染频率控制", "extended", ["setState", "useEffect", "render"], ["renderCount", "dependency"], ["React"], "定位重复渲染和状态震荡。"),
    r("前端渲染", "防抖/节流", "core", ["debounce", "throttle", "input"], ["interval", "eventRate"], ["搜索框", "拖拽"], "平衡响应速度和计算频率。"),
    r("热路径", "CPU 热路径识别", "extended", ["sort", "regex", "crypto", "compress"], ["callCount", "cost"], ["计算密集函数"], "给优化优先级排序。", ["需要 profiler 样本"]),
    r("稳定权衡", "替代方案收益模型", "core", ["optimized", "baseline", "tradeoff"], ["gain", "stabilityRisk"], ["流速控制"], "比较效率提升和稳定性下降。"),
  ],
  安全规则库: [
    r("污染流", "Source/Sink 污染追踪", "core", ["request", "input", "query", "sink"], ["source", "sink", "sanitizer"], ["Web", "CLI", "设备输入"], "解释外部数据怎样进入危险函数。"),
    r("注入", "SQL 注入模型", "core", ["query", "raw", "sql"], ["rawSql", "parameterized"], ["SQL", "ORM"], "标记拼接 SQL 和缺参数绑定。"),
    r("注入", "命令注入模型", "core", ["exec", "spawn", "system"], ["command", "args", "allowlist"], ["Node", "Python", "Java", "C"], "识别外部输入进入系统命令。"),
    r("注入", "路径穿越模型", "core", ["path", "../", "readFile"], ["baseDir", "normalize"], ["文件系统"], "检查路径是否被限制在工作区。"),
    r("Web", "XSS Sink 模型", "core", ["innerHTML", "dangerouslySetInnerHTML"], ["html", "escape"], ["浏览器", "React"], "发现未转义 HTML 输出。"),
    r("Web", "SSRF 请求模型", "core", ["fetch", "requests", "http"], ["url", "allowlist", "privateIp"], ["后端 HTTP"], "防止服务端访问内网或元数据地址。"),
    r("序列化", "不安全反序列化", "core", ["pickle", "readObject", "deserialize"], ["format", "classFilter"], ["Python", "Java", "PHP"], "识别可执行对象反序列化。"),
    r("权限", "认证边界模型", "core", ["auth", "session", "token"], ["principal", "guard"], ["API", "服务端动作"], "判断敏感写操作是否经过认证。"),
    r("权限", "授权/越权模型", "core", ["role", "owner", "permission"], ["resourceOwner", "policy"], ["多租户", "后台管理"], "判断用户是否只能访问自己的资源。"),
    r("Web", "CSRF 写操作模型", "core", ["post", "mutation", "form"], ["csrfToken", "sameSite"], ["Web 表单"], "识别跨站写操作保护缺失。"),
    r("Web", "CORS 过宽模型", "core", ["Access-Control-Allow-Origin", "credentials"], ["origin", "credentials"], ["HTTP API"], "发现通配 origin 与凭据共存。"),
    r("加密", "JWT 验证模型", "core", ["jwt", "decode", "verify"], ["algorithm", "aud", "iss", "exp"], ["认证"], "检查 token 是否真实验证并绑定声明。"),
    r("加密", "弱加密/硬编码密钥", "core", ["md5", "sha1", "secret", "key"], ["algorithm", "secretSource"], ["认证", "签名"], "识别弱算法和源码密钥。"),
    r("依赖", "依赖漏洞窗口", "extended", ["package", "version", "cve"], ["packageName", "versionRange"], ["包管理器"], "把版本差异映射到安全风险。", ["需要 CVE 数据源"]),
    r("供应链", "包脚本与安装钩子", "extended", ["postinstall", "preinstall"], ["script", "package"], ["npm", "pip"], "识别依赖安装阶段执行风险。"),
    r("文件上传", "上传内容验证模型", "core", ["upload", "mime", "extension"], ["mime", "size", "storagePath"], ["Web 上传"], "检查文件类型、大小和存储边界。"),
    r("隔离", "租户隔离模型", "extended", ["tenant", "orgId", "workspace"], ["tenantKey", "queryFilter"], ["SaaS"], "发现跨租户查询和缓存泄漏。", ["需要真实业务字段映射"]),
    r("日志", "敏感数据日志模型", "core", ["console", "log", "password", "token"], ["secret", "redaction"], ["服务端", "CLI"], "避免密码、token、隐私数据进入日志。"),
    r("执行", "unsafe eval 模型", "core", ["eval", "Function", "vm"], ["codeSource", "sandbox"], ["JS", "Python"], "识别动态代码执行和沙箱逃逸风险。"),
    r("模板", "模板注入模型", "extended", ["template", "render", "{{"], ["templateEngine", "escape"], ["Web 框架"], "识别用户输入进入模板表达式。"),
  ],
  稳定性规则库: [
    r("超时", "超时边界模型", "core", ["timeout", "abort", "deadline"], ["timeoutMs", "abortSignal"], ["网络", "设备", "数据库"], "防止水路长期悬挂。"),
    r("重试", "重试/退避模型", "core", ["retry", "backoff", "attempt"], ["maxAttempts", "jitter"], ["HTTP", "队列"], "避免重试风暴和重复副作用。"),
    r("隔离", "熔断器模型", "extended", ["circuit", "fallback", "open"], ["failureRate", "cooldown"], ["外部服务"], "隔离连续失败的下游。", ["需要运行样本"]),
    r("幂等", "幂等写操作模型", "core", ["idempotent", "requestId", "dedupe"], ["idempotencyKey", "sideEffect"], ["支付", "任务"], "防止重试造成重复写入。"),
    r("事务", "事务回滚模型", "core", ["transaction", "commit", "rollback"], ["writeSet", "rollback"], ["数据库写入"], "避免部分写入造成断层。"),
    r("并发一致性", "死锁/锁竞争模型", "extended", ["lock", "mutex", "deadlock"], ["lockOrder", "holdTime"], ["并发", "数据库"], "发现长锁和锁序反转。"),
    r("并发一致性", "竞态与丢失更新模型", "core", ["read", "modify", "write"], ["version", "transaction"], ["缓存", "数据库"], "发现并发覆盖和旧数据回写。"),
    r("边界", "空值/未定义边界", "core", ["null", "undefined", "None"], ["nullable", "guard"], ["所有语言"], "检查水中元素是否在节点中丢失。"),
    r("边界", "越界/溢出边界", "core", ["index", "length", "overflow"], ["bounds", "max"], ["数组", "数值"], "防止下标越界和数值满溢。"),
    r("资源释放", "资源清理模型", "core", ["finally", "close", "dispose"], ["resource", "cleanup"], ["文件", "连接", "设备"], "检查打开资源是否关闭。"),
    r("时间", "时钟/时区漂移模型", "extended", ["date", "timezone", "now"], ["timezone", "clockSource"], ["调度", "日志"], "发现本地时间导致的异常路径。"),
    r("设备稳定", "设备离线模型", "core", ["serial", "gpio", "mqtt", "heartbeat"], ["heartbeat", "reconnect"], ["硬件", "IoT"], "识别传感器或执行器断流。"),
    r("设备稳定", "看门狗安全态模型", "core", ["watchdog", "safeStop", "relay"], ["maxDuration", "safeState"], ["执行器"], "确保输出失控时回到安全态。"),
    r("降级", "优雅降级模型", "extended", ["fallback", "default", "degrade"], ["fallbackQuality", "trigger"], ["外部服务"], "判断失败时是否有可控出口。"),
    r("迁移", "Schema 迁移兼容模型", "extended", ["migration", "schema", "alter"], ["oldSchema", "newSchema"], ["数据库"], "识别版本升级导致的数据断流。"),
    r("队列", "毒消息与恢复模型", "extended", ["dead letter", "poison", "ack"], ["retryCount", "dlq"], ["消息队列"], "避免单条异常消息堵塞主河道。"),
  ],
  语言生态库: [
    r("TypeScript", "TS 类型收窄与 any", "core", ["any", "unknown", "as"], ["type", "narrowing"], ["TypeScript"], "提升函数输入输出类型可信度。"),
    r("JavaScript", "Node.js 标准库风险", "core", ["fs", "child_process", "crypto"], ["module", "api"], ["Node"], "识别文件、命令、加密和网络 API 风险。"),
    r("Python", "Python 动态执行与 pickle", "core", ["eval", "exec", "pickle"], ["api", "source"], ["Python"], "识别动态代码和反序列化风险。"),
    r("Python", "Python 类型提示与异常", "extended", ["typing", "except", "requests"], ["annotation", "exception"], ["Python"], "提高 Python 函数签名和稳定性判断。"),
    r("Java", "JDK 进程与序列化", "core", ["Runtime.exec", "ObjectInputStream"], ["api", "filter"], ["Java"], "识别命令执行和反序列化风险。"),
    r("Java", "Spring MVC 契约", "extended", ["@RequestMapping", "@Valid", "@PreAuthorize"], ["annotation", "principal"], ["Spring"], "判断 Web 入口验证和权限边界。"),
    r("C/C++", "C 内存边界 API", "core", ["strcpy", "gets", "sprintf"], ["buffer", "length"], ["C", "C++"], "标记无边界内存/字符串操作。"),
    r("C/C++", "嵌入式接口库", "extended", ["Serial", "digitalWrite", "analogRead"], ["pin", "timeout"], ["Arduino", "ESP"], "把硬件输入输出映射到水流节点。"),
    r("Go", "context 与 goroutine", "core", ["context.Context", "go func", "defer"], ["context", "cancel"], ["Go"], "判断协程生命周期和超时边界。"),
    r("Rust", "Result/Option 与 unsafe", "core", ["Result", "Option", "unsafe"], ["unwrap", "unsafe"], ["Rust"], "识别 panic 边界和 unsafe 风险。"),
    r("SQL", "SQL 查询契约", "core", ["select", "insert", "where"], ["predicate", "join"], ["SQL"], "为数据库水路补输入输出表结构。"),
    r("Shell", "Shell 参数与管道", "core", ["$@", "eval", "|"], ["args", "quote"], ["Bash", "Zsh"], "识别命令注入和未引用变量。"),
    r("Web", "DOM 与浏览器 API", "core", ["innerHTML", "localStorage", "fetch"], ["sink", "origin"], ["Browser"], "分析前端数据流和 XSS/CORS 风险。"),
    r("C#", ".NET 进程与反射", "planned", ["Process.Start", "Reflection"], ["api", "permission"], [".NET"], "后续覆盖企业项目常用 API。", ["待接 C# 解析器"]),
    r("PHP", "PHP Web 输入与反序列化", "planned", ["$_GET", "unserialize"], ["superglobal", "sink"], ["PHP"], "后续覆盖 PHP Web 项目风险。", ["待接 PHP 解析器"]),
    r("Kotlin", "Kotlin 空安全与协程", "planned", ["nullable", "suspend"], ["nullable", "scope"], ["Kotlin"], "后续覆盖 Android/后端 Kotlin 项目。", ["待接 Kotlin 解析器"]),
    r("Swift", "Swift Optional 与并发", "planned", ["Optional", "async"], ["optional", "task"], ["Swift"], "后续覆盖 Apple 端项目。", ["待接 Swift 解析器"]),
    r("Ruby", "Ruby 元编程与 Rails", "planned", ["send", "params", "ActiveRecord"], ["api", "params"], ["Ruby"], "后续覆盖 Rails 项目常见风险。", ["待接 Ruby 解析器"]),
  ],
  运行环境库: [
    r("Node", "Node/Next 运行画像", "core", ["package.json", "next.config", "npm run"], ["scripts", "engines"], ["TS/JS 项目"], "确认构建、启动和服务端运行条件。"),
    r("Python", "Python venv/依赖画像", "core", ["requirements.txt", "pyproject.toml"], ["pythonVersion", "deps"], ["Python 项目"], "确认解释器、虚拟环境和测试命令。"),
    r("JDK", "Java/JDK 构建画像", "extended", ["pom.xml", "gradle", "java"], ["jdkVersion", "buildTool"], ["Java 项目"], "识别 JDK 和构建工具缺失。"),
    r("Go", "Go modules 画像", "extended", ["go.mod", "go.sum"], ["goVersion", "module"], ["Go 项目"], "识别 Go 版本和依赖漂移。"),
    r("Rust", "Cargo 画像", "extended", ["Cargo.toml", "Cargo.lock"], ["edition", "features"], ["Rust 项目"], "确认 feature、target 和依赖锁定。"),
    r("Docker", "容器运行画像", "core", ["Dockerfile", "compose"], ["image", "ports", "limits"], ["部署"], "检查运行载体、端口和资源限制。"),
    r("环境变量", "Env/Secrets 画像", "core", [".env", "process.env", "secret"], ["requiredEnv", "secret"], ["所有项目"], "识别缺失配置和敏感变量来源。"),
    r("CI", "测试与构建命令画像", "core", ["test", "build", "lint"], ["command", "exitCode"], ["交付流程"], "把可验证命令交给 Runtime Lab。"),
  ],
  电子元件参数库: [
    r("GPIO", "GPIO 数字输入输出", "core", ["digitalRead", "digitalWrite", "pinMode"], ["pin", "mode", "voltage"], ["嵌入式"], "检查引脚模式和默认安全态。"),
    r("UART", "UART/Serial 传感器", "core", ["Serial.read", "baud", "available"], ["baudRate", "timeout"], ["传感器"], "判断串口空读、粘包和断流。"),
    r("I2C", "I2C 总线设备", "core", ["Wire", "address", "sda", "scl"], ["address", "pullup"], ["传感器", "模块"], "检查地址冲突和总线错误。"),
    r("SPI", "SPI 高速外设", "extended", ["SPI", "MISO", "MOSI", "CS"], ["clock", "mode"], ["显示屏", "存储"], "判断片选、速率和传输模式。"),
    r("ADC", "ADC 模拟采样", "core", ["analogRead", "adc", "sample"], ["resolution", "sampleRate"], ["传感器"], "检查量程、采样率和噪声。"),
    r("PWM", "PWM 控制输出", "core", ["analogWrite", "pwm", "duty"], ["frequency", "duty"], ["电机", "LED"], "判断控制周期、占空比和过载。"),
    r("执行器", "继电器/电机安全模型", "core", ["relay", "motor", "servo"], ["current", "maxDuration"], ["执行器"], "确保看门狗、急停和默认安全态。"),
    r("传感器", "传感器容差与漂移", "extended", ["temperature", "pressure", "calibrate"], ["tolerance", "drift"], ["传感器"], "把硬件误差传导到数据置信度。", ["需要 datasheet"]),
  ],
  语义索引库: [
    r("文件", "project_files 索引", "core", ["path", "language", "hash"], ["path", "hash", "imports"], ["文件夹导入"], "支持增量扫描和主控文件识别。"),
    r("函数", "project_functions 索引", "core", ["function", "signature"], ["name", "range", "summary"], ["函数图"], "保存函数边界、类型和能力摘要。"),
    r("符号", "function_symbols 索引", "core", ["param", "return", "risk"], ["kind", "dataType"], ["水中元素"], "保存参数、输出、验证和副作用。"),
    r("调用边", "call_edges 索引", "core", ["call", "import"], ["from", "to", "confidence"], ["代码树"], "支撑函数之间的方向和连接证据。"),
    r("水系节点", "flow_nodes 索引", "core", ["capacity", "confidence", "status"], ["capacity", "x", "y"], ["水文图"], "保存节点容量、位置和状态。"),
    r("水系边", "flow_edges 索引", "core", ["volume", "status", "primary"], ["from", "to", "volume"], ["水文图"], "保存河流/小溪/闭环线路与问题颜色。"),
    r("规则命中", "rule_matches 索引", "core", ["rule", "evidence", "recommendation"], ["ruleId", "functionId"], ["点击浮窗"], "解释节点或水路为什么变色。"),
    r("运行轨迹", "data_flow_traces 索引", "extended", ["input", "output", "outcome"], ["path", "outcome"], ["Runtime Lab"], "保存输入到输出的仿真路径和异常。"),
  ],
  工具适配器: [
    r("TypeScript Compiler", "TypeScript Compiler API", "core", ["ts.SyntaxKind", "program", "checker"], ["ast", "type", "symbol"], ["TS/JS"], "抽离真实 AST、类型和引用。"),
    r("Tree-sitter", "Tree-sitter 多语言 AST", "core", ["tree-sitter", "query"], ["nodeType", "range", "call edge", "macro site"], ["多语言"], "native Tauri 语法层为 15 类语言提供统一 AST 事实。"),
    r("LSP", "Language Server Protocol", "core", ["definition", "references", "diagnostics"], ["uri", "range", "diagnostic", "hover"], ["多语言"], "通过受管 sidecar 拿到类型、引用、定义和诊断证据。", ["跨平台发布包仍需携带校验 sidecar"]),
    r("Pyright", "Pyright Python 解析器", "core", ["pyright", "python"], ["type", "definition", "references", "diagnostic"], ["Python"], "提升 Python 跨文件类型与引用可信度。", ["发布包仍需携带 Node runtime sidecar"]),
    r("gopls", "gopls Go 解析器", "core", ["gopls", "go"], ["symbol", "definition", "references", "diagnostic"], ["Go"], "解析 Go module、类型和引用。", ["发布包仍需携带校验 sidecar"]),
    r("rust-analyzer", "rust-analyzer 适配器", "core", ["rust-analyzer"], ["symbol", "definition", "references", "diagnostic", "macro expansion"], ["Rust"], "解析 Rust Result/Option/unsafe 和宏展开证据。", ["发布包仍需携带校验 sidecar"]),
    r("clangd", "clangd C/C++ 适配器", "core", ["clangd"], ["symbol", "definition", "references", "diagnostic", "ast"], ["C/C++"], "解析指针、宏、AST 和编译诊断。", ["发布包仍需携带校验 sidecar"]),
    r("JDT LS", "Java JDT LS 适配器", "core", ["jdtls", "java"], ["symbol", "definition", "references", "diagnostic"], ["Java"], "解析 Java 类型、注解和调用引用。", ["发布包仍需携带校验 sidecar"]),
  ],
};

export const localMatureLibraryEntries: MatureLibraryEntry[] = (Object.keys(localMatureLibraryGroups) as LocalLibraryCategory[]).flatMap(
  (category) =>
    localMatureLibraryGroups[category].map((entry, index) => ({
      id: `${categorySlug[category]}-${String(index + 1).padStart(2, "0")}`,
      category,
      ...entry,
    })),
);

export function matureLibraryEntriesByCategory(category: LocalLibraryCategory) {
  return localMatureLibraryEntries.filter((entry) => entry.category === category);
}

export function matureLibraryCountByCategory(category: LocalLibraryCategory) {
  return matureLibraryEntriesByCategory(category).length;
}

export function matureLibraryTotalCount() {
  return localMatureLibraryEntries.length;
}

export function matureLibraryAuditByCategory(category: LocalLibraryCategory): MatureLibraryAudit {
  const target = localMatureLibraryTargets[category];
  const entries = matureLibraryEntriesByCategory(category);
  const coveredDomains = Array.from(new Set(entries.map((entry) => entry.domain)));
  const missingDomains = target.coreDomains.filter((domain) => !coveredDomains.includes(domain));
  const coreCount = entries.filter((entry) => entry.maturity === "core").length;
  const extendedCount = entries.filter((entry) => entry.maturity === "extended").length;
  const plannedCount = entries.filter((entry) => entry.maturity === "planned").length;
  const countScore = Math.min(100, Math.round((entries.length / target.targetCount) * 100));
  const domainScore = Math.round(((target.coreDomains.length - missingDomains.length) / target.coreDomains.length) * 100);
  const coreScore = Math.min(100, Math.round((coreCount / Math.max(1, target.targetCount * 0.62)) * 100));
  const percent = clamp(Math.round(countScore * 0.42 + domainScore * 0.34 + coreScore * 0.24));

  return {
    category,
    entryCount: entries.length,
    targetCount: target.targetCount,
    coreCount,
    extendedCount,
    plannedCount,
    percent,
    status: statusFor(percent, entries.length, target.targetCount),
    coveredDomains,
    missingDomains,
    next: missingDomains.length ? `补齐 ${missingDomains.join("、")} 核心域。${target.next}` : target.next,
  };
}

export function matureLibraryAuditSummary() {
  const audits = (Object.keys(localMatureLibraryTargets) as LocalLibraryCategory[]).map((category) =>
    matureLibraryAuditByCategory(category),
  );
  const overall = clamp(Math.round(average(audits.map((item) => item.percent))));
  return {
    overall,
    categoryCount: audits.length,
    entryCount: matureLibraryTotalCount(),
    coreCount: audits.reduce((sum, item) => sum + item.coreCount, 0),
    extendedCount: audits.reduce((sum, item) => sum + item.extendedCount, 0),
    plannedCount: audits.reduce((sum, item) => sum + item.plannedCount, 0),
    matureCategoryCount: audits.filter((item) => item.status === "成熟数据").length,
    audits,
  };
}

function statusFor(percent: number, entryCount: number, targetCount: number): LocalLibraryStatus {
  if (percent >= 82 && entryCount >= targetCount) return "成熟数据";
  if (percent >= 58) return "部分具备";
  if (percent >= 24) return "种子数据";
  return "需要建设";
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
