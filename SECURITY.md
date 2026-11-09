# 보안 정책 / Security policy

보안 취약점을 발견하셨다면 **공개 이슈 대신** 이 레포의 **Security → Report a vulnerability**(비공개 취약점 신고)로 알려 주세요. 확인 후 답변드리고, 고친 버전을 릴리스하면서 함께 안내합니다.

If you find a security issue, please **do not open a public issue**. Use **Security → Report a vulnerability** in this repository to report it privately. We will reply after checking and announce the fix with a release.

이 도구는 네트워크 포트를 열지 않고 stdio 로만 동작하며, `proxy`·`simulate` 는 인자로 받은 MCP 서버 명령을 그대로 실행합니다. 신뢰하는 명령만 감싸 주세요. / This tool opens no network port and works over stdio only; `proxy` and `simulate` run the MCP server command you pass, exactly as given. Only wrap commands you trust.
