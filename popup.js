document.addEventListener("DOMContentLoaded", () => {
  const extractBtn = document.getElementById("extractBtn");
  const copyBtn = document.getElementById("copyBtn");
  const resultBox = document.getElementById("resultBox");
  const statusDiv = document.getElementById("status");
  const includeTitleCheck = document.getElementById("includeTitle");

  extractBtn.addEventListener("click", async () => {
    extractBtn.disabled = true;
    copyBtn.disabled = true;
    resultBox.value = "";
    statusDiv.textContent = "正在掃描頁面並自動載入清單項目...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || (!tab.url.includes("youtube.com/playlist") && !tab.url.includes("youtube.com/watch"))) {
      statusDiv.textContent = "請切換至 YouTube 播放清單頁面後再試！";
      extractBtn.disabled = false;
      return;
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPlaylistVideos,
        args: [includeTitleCheck.checked]
      });

      const videoList = results[0]?.result || [];
      if (videoList.length === 0) {
        statusDiv.textContent = "未找到任何影片項目，請確認頁面是否為播放清單。";
      } else {
        resultBox.value = videoList.join("\n");
        statusDiv.textContent = `擷取成功！共 ${videoList.length} 部影片`;
        copyBtn.disabled = false;
      }
    } catch (err) {
      statusDiv.textContent = "擷取失敗：" + err.message;
    } finally {
      extractBtn.disabled = false;
    }
  });

  copyBtn.addEventListener("click", async () => {
    if (!resultBox.value) return;
    await navigator.clipboard.writeText(resultBox.value);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = "已複製！";
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 1500);
  });
});

// 注入頁面執行的函式
async function extractPlaylistVideos(includeTitle) {
  // 1. 自動向下滾動到底，確保所有影片節點載入
  let previousHeight = 0;
  let sameHeightCount = 0;
  const maxRetries = 3;

  while (sameHeightCount < maxRetries) {
    const currentHeight = document.documentElement.scrollHeight;
    window.scrollTo(0, currentHeight);
    await new Promise((res) => setTimeout(res, 500));

    if (currentHeight === previousHeight) {
      sameHeightCount++;
    } else {
      sameHeightCount = 0;
      previousHeight = currentHeight;
    }
  }

  // 2. 獲取頁面上所有清單項目容器
  const allContainers = document.querySelectorAll(
    "ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer"
  );

  // 【關鍵修正】過濾出真正在畫面上「可見」的元素，排除 YouTube 快取在背景的舊頁面 DOM
  const visibleContainers = Array.from(allContainers).filter(
    (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0
  );

  const seenIds = new Set();
  const outputs = [];

  if (visibleContainers.length > 0) {
    visibleContainers.forEach((item) => {
      const anchor = item.querySelector("a[href*='watch?v=']");
      if (!anchor) return;

      const href = anchor.getAttribute("href") || "";
      const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (!match) return;

      const videoId = match[1];
      if (!seenIds.has(videoId)) {
        seenIds.add(videoId);
        const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // 嘗試多種標題選擇器
        const titleElem = item.querySelector("#video-title, #video-title-link, a#wc-endpoint span#video-title");
        let title = "";
        if (titleElem) {
          title = (titleElem.getAttribute("title") || titleElem.textContent || "").trim();
        }

        if (includeTitle && title) {
          outputs.push(`${title} - ${cleanUrl}`);
        } else {
          outputs.push(cleanUrl);
        }
      }
    });
  } else {
    // 備用機制：若找不到標準容器，直接掃描頁面所有帶 watch?v= 的「可見」連結
    const allWatchLinks = Array.from(document.querySelectorAll("a[href*='watch?v=']")).filter(
      (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0
    );
    
    // 取得當前網址的清單 ID，用來避免備用機制抓到無關的推薦影片
    const urlParams = new URLSearchParams(window.location.search);
    const currentListId = urlParams.get("list");

    allWatchLinks.forEach((anchor) => {
      const href = anchor.getAttribute("href") || "";
      
      // 確保連結屬於目前的播放清單
      if (currentListId && href.includes("list=") && !href.includes(`list=${currentListId}`)) {
        return; 
      }

      const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (!match) return;

      const videoId = match[1];
      if (!seenIds.has(videoId)) {
        seenIds.add(videoId);
        const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const title = (anchor.getAttribute("title") || anchor.textContent || "").trim();

        if (includeTitle && title) {
          outputs.push(`${title} - ${cleanUrl}`);
        } else {
          outputs.push(cleanUrl);
        }
      }
    });
  }

  return outputs;
}