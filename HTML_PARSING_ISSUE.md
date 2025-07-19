# HTML Parsing Issue - Critical Fix Needed

## 🐛 Current Problem

**Example received:** Anthropic Team email shows CSS instead of content:
```
div.zm_8462249695113328692_parse_8594823918499912835 * { box-sizing: border-box }
div.zm_8462249695113328692_parse_8594823918499912835 { margin: 0; padding: 0 }
...instead of actual email text
```

## 🔍 Root Cause

**Current HTML stripping is too basic:**
```javascript
const cleanContent = emailContent.replace(/<[^>]*>/g, '').trim();
```

This only removes HTML tags `<tag>` but leaves:
- ❌ CSS styles in `<style>` blocks
- ❌ Embedded CSS 
- ❌ Complex HTML structures
- ❌ Multiple whitespace/newlines

## 🛠️ Proposed Solution

### Option 1: Better Regex (Quick Fix)
```javascript
function cleanHtmlContent(html) {
  return html
    // Remove style blocks completely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove script blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
```

### Option 2: HTML Parser Library (Robust)
```javascript
const cheerio = require('cheerio');

function cleanHtmlContent(html) {
  const $ = cheerio.load(html);
  
  // Remove style and script tags
  $('style, script').remove();
  
  // Get text content only
  return $.text()
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1000); // Limit length for Discord
}
```

### Option 3: Fallback Strategy (Safest)
```javascript
function cleanHtmlContent(html, summary) {
  // Try parsing HTML
  let cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // If result is mostly CSS/junk, use summary instead
  if (cleaned.includes('box-sizing') || cleaned.includes('margin:') || cleaned.length > 500) {
    return summary || 'HTML email - content not displayable';
  }
  
  return cleaned.substring(0, 1000);
}
```

## 🎯 Recommended Approach

**Start with Option 1** (better regex) as it requires no new dependencies:

```javascript
// In webhook handler, replace current line:
const cleanContent = emailContent.replace(/<[^>]*>/g, '').trim();

// With improved version:
const cleanContent = cleanHtmlContent(emailData.html, emailData.summary);

function cleanHtmlContent(html, summary) {
  if (!html) return summary || 'No content available';
  
  let cleaned = html
    // Remove style blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove script blocks  
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  // Fallback to summary if result looks like CSS
  if (cleaned.includes('box-sizing') || 
      cleaned.includes('margin:') || 
      cleaned.includes('padding:') ||
      cleaned.length < 10) {
    return summary || 'HTML email - content preview not available';
  }
  
  return cleaned.substring(0, 1000);
}
```

## 📋 Next Session Action Items

1. **High Priority:** Implement improved HTML cleaning function
2. **Test:** Send test email with complex HTML to verify fix
3. **Consider:** Adding cheerio dependency for robust HTML parsing
4. **Fallback:** Use Zoho's `summary` field when HTML parsing fails

## 💡 Additional Improvements

- **Truncate long content** with "..." 
- **Add "View in Zoho" link** for complex emails
- **Detect email type** (HTML vs plain text)
- **Preview images** if present