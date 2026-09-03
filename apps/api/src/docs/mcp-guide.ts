import { MCP_CORPUS } from '../mcp/corpus';
import type { DocsBlock } from './blocks';

export type ToolName = 'find_ticket' | 'get_ticket' | 'get_ticket_history' | 'list_open';

type AgentConfig = {
  mcpServers: Record<
    string,
    { type: 'http'; url: string; headers: { Authorization: string } }
  >;
};

export const AGENT_CONFIG_SAMPLE: AgentConfig = {
  mcpServers: {
    'issue-board': {
      type: 'http',
      url: 'https://issue.anhth.cc/api/mcp',
      headers: { Authorization: 'Bearer jbmcp_REPLACE_ME.REPLACE_WITH_YOUR_TOKEN' },
    },
  },
};

export const MCP_GUIDE_CONTACT = 'Hãy hỏi operator đã cấp token cho bạn.';

const PARAMETERS = ['Tham số', 'Kiểu', 'Bắt buộc', 'Mặc định', 'Giới hạn'];

export const TOOL_SECTIONS: Record<ToolName, readonly DocsBlock[]> = {
  find_ticket: [
    { kind: 'h3', text: 'find_ticket' },
    {
      kind: 'p',
      text:
        'Tìm trong toàn bộ mirror theo mã ticket, tiêu đề, tên shop, domain hoặc link chat, Slack, link rút gọn. Kết quả mới nhất đứng trước.',
    },
    {
      kind: 'table',
      headers: PARAMETERS,
      rows: [
        ['query', 'string', 'Có', '—', 'Ít nhất 1 ký tự'],
        ['limit', 'integer', 'Không', '10', 'Từ 1 đến 50'],
      ],
    },
    {
      kind: 'p',
      text:
        'Kết quả gồm mirror và tickets. Mỗi ticket có ticketId, subject, category, shopName, domain, memberNames, createdAt, các link, status và ticketStatus.',
    },
  ],
  get_ticket: [
    { kind: 'h3', text: 'get_ticket' },
    {
      kind: 'p',
      text:
        'Đọc một ticket theo ticketId chính xác trong toàn bộ mirror, kèm dữ liệu HelpDesk, category và tên tag đã resolve.',
    },
    {
      kind: 'table',
      headers: PARAMETERS,
      rows: [['ticketId', 'string', 'Có', '—', 'Ít nhất 1 ký tự']],
    },
    {
      kind: 'p',
      text:
        'Kết quả thành công gồm mirror và ticket. Nếu không có ticket, tool trả error: not_found và đánh dấu isError.',
    },
  ],
  get_ticket_history: [
    { kind: 'h3', text: 'get_ticket_history' },
    {
      kind: 'p',
      text:
        'Đọc lịch sử status mà mirror đã quan sát cho một ticket chính xác; entries được xếp từ cũ đến mới.',
    },
    {
      kind: 'table',
      headers: PARAMETERS,
      rows: [['ticketId', 'string', 'Có', '—', 'Ít nhất 1 ký tự']],
    },
    {
      kind: 'p',
      text:
        'Kết quả gồm mirror, ticketId và entries; mỗi entry có fromStatus, toStatus, observedAt và ticketUpdatedAt. Ticket không có trong mirror trả error: not_found và isError.',
    },
  ],
  list_open: [
    { kind: 'h3', text: 'list_open' },
    {
      kind: 'p',
      text:
        'Liệt kê mọi ticket open trong mirror, có thể lọc theo workflow status và category, rồi phân trang từ mới đến cũ.',
    },
    {
      kind: 'table',
      headers: PARAMETERS,
      rows: [
        ['status', 'string', 'Không', '—', 'Ít nhất 1 ký tự'],
        ['category', 'string', 'Không', '—', 'Ít nhất 1 ký tự'],
        ['limit', 'integer', 'Không', '25', 'Từ 1 đến 100'],
        ['cursor', 'string số', 'Không', '—', 'Chỉ gồm chữ số'],
      ],
    },
    {
      kind: 'p',
      text:
        'Kết quả gồm mirror, counts, total, tickets và nextCursor. counts luôn thống kê tất cả ticket open trước khi lọc; total là số ticket sau bộ lọc, không phải số ticket của riêng trang hiện tại.',
    },
    {
      kind: 'p',
      text:
        'counts.statuses đưa năm cột cố định của board lên trước. Các status còn lại xếp theo label hiển thị; dấu gạch dưới hoặc gạch ngang đổi thành khoảng trắng, ví dụ done_for_you thành Done for you, còn status trống thành No status.',
    },
  ],
};

const TOOL_BLOCKS = (Object.keys(TOOL_SECTIONS) as ToolName[]).flatMap(
  (name) => TOOL_SECTIONS[name]
);

export const MCP_GUIDE_BLOCKS: readonly DocsBlock[] = [
  { kind: 'h2', text: 'MCP server này là gì' },
  {
    kind: 'p',
    text:
      'MCP server giúp bạn dùng agent để tìm ticket của board, đọc chi tiết và xem lịch sử status đã được hệ thống quan sát. Nó dành cho teammate dùng MCP qua agent, không phải tài liệu vận hành server.',
  },
  {
    kind: 'p',
    text:
      'Dữ liệu là mirror chỉ đọc của HelpDesk: tool không có đường ghi, và luồng đồng bộ lên HelpDesk chỉ dùng GET. Agent không thể sửa ticket, đổi board hay chạy pull qua bốn tool này.',
  },
  { kind: 'h2', text: 'Lấy token' },
  {
    kind: 'p',
    text:
      'Bạn gửi yêu cầu cho operator. Operator chạy bun run mcp:issue bên trong container trên VPS; máy host VPS không có Bun, và teammate không tự chạy lệnh này.',
  },
  {
    kind: 'p',
    text:
      'Secret chỉ hiện một lần khi cấp. Server chỉ lưu SHA-256 digest. Operator chuyển token cho bạn qua kênh riêng; không đưa token vào ticket, report, shell transcript hoặc repository.',
  },
  {
    kind: 'p',
    text:
      'Phần thao tác dành cho operator nằm tại docs/mcp-deploy.md. Đây là đường dẫn plain text trong repository, không phải URL trên board.',
  },
  { kind: 'h2', text: 'Cấu hình agent' },
  {
    kind: 'p',
    text:
      'Endpoint là https://issue.anhth.cc/api/mcp. Xác thực bằng personal bearer token trong header Authorization, không dùng browser session cookie.',
  },
  {
    kind: 'p',
    text:
      'Thay giá trị placeholder sau chữ Bearer bằng token operator gửi cho bạn, rồi đặt object này vào phần cấu hình MCP của agent:',
  },
  { kind: 'code', text: JSON.stringify(AGENT_CONFIG_SAMPLE, null, 2) },
  {
    kind: 'p',
    text:
      'Sau khi kết nối, agent phải thấy đúng bốn tool bên dưới. Mọi tool trả một MCP result; JSON payload nằm trong chuỗi content[0].text và cần được parse trước khi đọc field.',
  },
  { kind: 'h2', text: 'Bốn tool' },
  ...TOOL_BLOCKS,
  { kind: 'h2', text: 'Corpus — cái gì tool nhìn thấy' },
  { kind: 'code', text: MCP_CORPUS },
  {
    kind: 'p',
    text:
      'Dòng tiếng Anh phía trên được dùng nguyên văn trong mô tả mà agent đọc. find_ticket, get_ticket và get_ticket_history đọc ticket open lẫn closed trong whole mirror; riêng list_open chỉ liệt kê mọi ticket open đúng như tên gọi.',
  },
  {
    kind: 'p',
    text:
      'Cấu hình cột của Kanban board không còn quyết định ticket nào agent tìm thấy. Ẩn hoặc hiện một cột trên board không thay đổi corpus của MCP.',
  },
  { kind: 'h2', text: 'Giới hạn — ba thứ mirror không biết' },
  { kind: 'h3', text: '1. Ticket mới đến đâu' },
  {
    kind: 'p',
    text:
      'lastSuccessfulPullAt và lastPullStatus chỉ mô tả full pull, không gồm webhook. lastSuccessfulPullAt là full pull thành công mới nhất; lastPullStatus là trạng thái của lần thử full pull mới nhất, nên hai field có thể nói về hai lần pull khác nhau.',
  },
  {
    kind: 'p',
    text:
      'lastWebhookAt là webhook thành công mới nhất thực sự ghi một ticket. Mốc freshness hữu ích là timestamp muộn hơn giữa lastSuccessfulPullAt và lastWebhookAt. Nếu ticket vừa đổi một phút trước nhưng cả hai mốc vẫn cũ, thay đổi đó có thể chưa vào mirror.',
  },
  { kind: 'h3', text: '2. Lịch sử trước ngày quan sát' },
  {
    kind: 'p',
    text:
      'get_ticket_history chỉ biết điều mirror đã quan sát từ 2026-08-24. Entry đầu tiên luôn có fromStatus: null và ghi lúc mirror thấy ticket lần đầu, không phải lúc ticket thật sự vào status đó.',
  },
  {
    kind: 'p',
    text:
      'Vì vậy ticket tạo trước ngày này có thể chỉ có một entry cuối tháng 8. Đây không phải lỗi và cũng không chứng minh ticket đã đổi status vào ngày được ghi.',
  },
  { kind: 'h3', text: '3. Nội dung find_ticket tìm kiếm' },
  {
    kind: 'p',
    text:
      'find_ticket khớp ticketId, subject, shopName, domain, chatLink, slackLink và shortUrl; nó không tìm trong ticket body hoặc nội dung hội thoại. Một cụm từ chỉ xuất hiện trong conversation sẽ không cho kết quả.',
  },
  {
    kind: 'p',
    text:
      'mirror.ticketCount luôn là số ticket của whole mirror, kể cả closed. Với list_open, dùng total để biết có bao nhiêu ticket open khớp bộ lọc.',
  },
  { kind: 'h2', text: 'Khi không chạy được' },
  {
    kind: 'table',
    headers: ['Dấu hiệu', 'Ý nghĩa và cách xử lý'],
    rows: [
      [
        '401',
        'Token đã bị revoke, gõ sai hoặc chưa gửi theo dạng Bearer. Xin token mới; không retry lặp lại.',
      ],
      [
        'not_found',
        'ticketId sai hoặc ticket có ở HelpDesk nhưng chưa tới mirror. Kiểm tra lastSuccessfulPullAt và lastWebhookAt.',
      ],
      [
        'find_ticket trả rỗng',
        'Mirror bao phủ ticket của năm dương lịch hiện tại từ full pull. Thử ticketId chính xác hoặc dán link ticket/chat.',
      ],
    ],
  },
  { kind: 'p', text: MCP_GUIDE_CONTACT },
];
