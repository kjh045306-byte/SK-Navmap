# SK-Navmap

## 개발 환경 설정

이 저장소를 새로 클론했다면 한 번만 실행:

```
git config core.hooksPath .githooks
```

`index.html`/`css`/`js`/`manifest.json`/`navmap_data.json`이 포함된 커밋을 만들 때마다
pre-commit 훅이 `sw.js`의 `CACHE_NAME`에 커밋 해시를 자동으로 반영해 서비스워커 캐시를
무효화한다(`.githooks/pre-commit` 참고). 위 설정을 하지 않으면 훅이 실행되지 않으니
이 파일들을 수정하는 커밋을 만들기 전에 반드시 한 번 실행할 것.