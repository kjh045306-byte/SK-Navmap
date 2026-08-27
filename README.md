# SK-Navmap

## 개발 환경 설정

이 저장소를 새로 클론했다면 한 번만 실행:

```
git config core.hooksPath .githooks
```

커밋을 만들 때마다 post-commit 훅(`.githooks/post-commit`)이 두 가지를 자동으로 처리한다:

- `sw.js`의 `CACHE_NAME`에 커밋 해시를 반영해 서비스워커 캐시를 무효화
- 커밋 메시지 첫 줄의 `[대규모]`/`[중간]`/`[소규모]` 태그를 읽어 `version.json`을 semver
  규칙대로 갱신(대규모→major+1, 중간→minor+1, 소규모→patch+1). 태그가 없으면 소규모로
  간주하고 경고만 출력한다.

위 설정을 하지 않으면 훅이 실행되지 않으니, 커밋을 만들기 전에 반드시 한 번 실행할 것.