---
name: /codechef
description: "CodeChef Learning Module Solver: Autonomously navigates slides, reads instructional text, solves multiple-choice and single-answer questions, edits code inside the web IDE, runs tests, and submits solutions to complete learning modules."
---

# CodeChef Learning Module Solver (`/codechef`)

This skill trains the agent to solve CodeChef college learning modules autonomously. It covers login, course navigation, page-type detection, solving MCQ/coding/statement slides, handling end-of-module dialogues, and looping through all incomplete sub-topics until the target module is 100% complete.

---

## 0. Login & Initial Navigation

### 0.1 Login Flow
- Navigate to `https://www.codechef.com` and check if already logged in by looking for the user's name in the header (class `_user__fullname_phs6a_1161`).
- If NOT logged in:
  1. Click the **Login** button in the header.
  2. Enter the username and password in the login form fields.
  3. Click the **Login** submit button.
  4. Wait 5 seconds for the redirect and verify the header now shows the user's full name.

### 0.2 College Dashboard Navigation
- If the task specifies a college course, navigate to `https://www.codechef.com/college/dashboard`.
- On the college dashboard page:
  1. Look for a **dropdown** to select a course (e.g., "KARE - CSE3301 - DAA - 2026").
  2. If the correct course is not already selected, click the dropdown and select the target course.
  3. Click the **"View"** or course link to enter the course page at `https://www.codechef.com/learn/course/<course-slug>`.

### 0.3 Course Syllabus Page
- The course page URL pattern: `https://www.codechef.com/learn/course/<course-slug>`
- The page shows **modules** as MUI Accordion sections (class `_modules_21zhj_105`).
- Each accordion has a title (class `_moduleTitle_21zhj_105`) with a `<span>` containing the module name (e.g., "Pre-requisites", "Divide and Conquer").
- Inside each expanded accordion, sub-topics are listed as `<a>` links in `_submoduleSummary_21zhj_161` divs.
- Each sub-topic link shows the lesson name in `_moduleName_21zhj_182`.
- **Completion indicator**: A solved sub-topic will have the icon `<i class="_problemSolved__icon_6an6e_255"></i>` visible in the sidebar or navigation bar. Sub-topics WITHOUT this icon are incomplete.

---

## 1. Page State Classification

On loading any slide, first inspect the DOM to classify the page state into one of four modes:

### 1.1 Instructional / Statement Slide
- **Detection**: The page shows text content in the left panel (class `_problemBody_bh3c4_71` or `_problemStatementWrapper_bh3c4_33`). There is NO code editor on the right. There are NO MCQ radio/checkbox options. The title usually starts with "Introduction to..." or similar.
- **URL pattern**: `/learn/course/<slug>/<lesson>/problems/<problem>`
- **Key DOM**: `div._problem-statement__container_rv6cj_2` contains the text. Bottom bar has Prev/Next navigation buttons.

### 1.2 Multiple Choice Question (MCQ)
- **Detection**: The RIGHT panel contains a `div._mcq_duw07_2` instead of a code editor. Inside it is a `div._mcqContainer_duw07_16` with:
  - A question heading in `div._mcqStatement_duw07_29 > h2` (e.g., "Select the correct options from the following.")
  - Answer options in `div._optionsContainer_duw07_35`
- **IMPORTANT**: If you see `_mcq_duw07_2` in the DOM, this is an MCQ page — do NOT skip it with Next. You MUST answer the MCQ first.
- **Key DOM**:
  - Each option is a `<label class="_optionBox_duw07_41">` containing:
    - A MUI Checkbox: `<input type="checkbox" name="option text here">` with class `PrivateSwitchBase-input`
    - The option text label: `<span class="_label_duw07_50">`
  - **Submit button**: `<button id="submit_btn" class="_submit__btn_duw07_276">Submit</button>` (inside `div._execute__btnContainer_duw07_223`)
  - **Next button (MCQ-specific)**: `<button class="_next__problem-link_duw07_238"><p class="_btn__text_duw07_262">Next</p></button>` — only click this AFTER getting correct answer
  - **Result container**: `div._runContainer_duw07_195` shows feedback after submit
- **Sidebar indicator**: MCQ items in the sidebar have `_textChipMCQ_21zhj_226` (shows "MCQ" chip) vs Coding items which have `_textChipCoding_21zhj_226` and Concept items which have `_textChipConcept_21zhj_226`.

### 1.3 Coding Challenge
- **Detection**: The page has a split layout — problem description on the left (`_problem-statement__container_rv6cj_2`) and a code editor (Ace/Monaco) on the right. There is a language dropdown, and **"Run"** and **"Submit"** buttons.
- **Key DOM**: The editor area contains `.ace_editor` or `.view-lines` (Monaco). Below it are the Run and Submit buttons.

### 1.4 Module-End Dialogue
- **Detection**: A MUI Dialog overlay appears (class `MuiDialog-container MuiDialog-scrollPaper`) with lesson completion stats.
- **Key DOM**: 
  - Lesson info: `_lessonInfoCard_dgmb2_100` shows "Lesson N" and the lesson name
  - Problems solved: `_solvedCountDetails_dgmb2_220` shows "05 / 06" format
  - XP gained: `_xpGain_dgmb2_363` shows "+115 XP gained"
  - Course progress: `_progressBar_dgmb2_402` shows "6% course completed"
  - **"Keep Learning"** button: `<a class="_primaryButton_dgmb2_496" href="...">Keep Learning</a>` — this is the CRITICAL button to click to proceed to the next module.
  - Rating stars: `MuiRating-root` — skip this, do not interact with ratings.
  - "Upgrade to Pro" banner: `_proNudgeBanner_dgmb2_635` — ignore this.

---

## 2. Instructional Slide Workflow

1. Read the content in the statement panel to register details.
2. Locate the **Next** button at the bottom right of the page:
   - The Next button is inside `<a class="_next__container_6an6e_133">` with text "Next" (or "Next module" for cross-module transitions).
   - The Prev button is `<a class="_previous__container_6an6e_113">`.
3. Click the **Next** button to advance.
4. Wait 3-5 seconds for the SPA to hydrate the next page.

---

## 3. MCQ / Quiz Slide Workflow

### 3.1 Detect MCQ Page
- **CRITICAL**: Before clicking Next on ANY page, check if `div._mcq_duw07_2` exists in the RIGHT panel. If it does, this is an MCQ — you MUST answer it.
- The left panel has the problem statement (question context, sample I/O). The right panel has the MCQ options.

### 3.2 Read Question and Context
1. Read the **left panel** (`_problemBody_bh3c4_71`) for the full problem statement, including sample inputs/outputs.
2. Read the **MCQ question heading** in the right panel (`_mcqStatement_duw07_29 > h2`).

### 3.3 Identify and Select Options
1. Find all `<label class="_optionBox_duw07_41">` elements in `_optionsContainer_duw07_35`.
2. Each label contains:
   - An `<input type="checkbox">` — click the LABEL (not the hidden input) to toggle selection.
   - A `<span class="_label_duw07_50">` — this is the option text to read.
3. Read ALL option texts. Analyze each against the problem statement and sample I/O.
4. Click the **label** elements for the correct option(s). The checkbox will visually fill.

### 3.4 Submit MCQ Answer
1. Click the **Submit** button: `button#submit_btn` (class `_submit__btn_duw07_276`).
2. Wait 3-5 seconds for feedback.
3. Check for success/failure message in `_runContainer_duw07_195`.

### 3.5 Error Recovery (On Incorrect)
- If the answer is wrong:
  1. Uncheck the wrong option(s) by clicking their labels again.
  2. Select different option(s) based on elimination.
  3. Click **Submit** again.
  4. Repeat until correct (max 4 attempts, then try remaining combinations).

### 3.6 Advance to Next
- **ONLY** after getting a correct answer, click the **Next** button.
- The MCQ Next button is: `button._next__problem-link_duw07_238` (text "Next" in `_btn__text_duw07_262`).
- Alternatively, use the bottom navigation Next: `a._next__container_6an6e_133`.
- Wait 3-5 seconds for SPA hydration.

---

## 4. Coding Challenge Workflow

1. **Read the Problem Statement Carefully**:
   - **CRITICAL**: Read the problem title and FULL description from the main content area (class `_problemBody_bh3c4_71`), NOT from the sidebar.
   - Pay special attention to:
     - **Input Format**: How inputs are structured (number of test cases, etc.)
     - **Output Format**: Exact expected output format (spaces, newlines, case sensitivity)
     - **Sample Input / Sample Output**: These are the test cases shown in the problem. Your code MUST produce output that matches the Sample Output EXACTLY for the given Sample Input.
     - **Constraints**: Value ranges that affect algorithm choice.

2. **Check Programming Language**: Note the active language in the editor dropdown (e.g., Python3, C++, Java). Do not change it unless required.

3. **Read the Existing Template Code**:
   - **CRITICAL**: Before writing new code, inspect what code is already in the editor.
   - Read `.view-line` or `.ace_line` elements to capture the template code structure.
   - Understand variable definitions, function signatures, and print statements.
   - **Do NOT clear the editor** until you have fully understood the template.

4. **Write Code Using `write_code_to_editor`**:
   - **CRITICAL**: You MUST ALWAYS use the `write_code_to_editor` tool to write code. NEVER click the editor canvas and try to type using click + type or fill actions.
   - **Do NOT write anything** in the 'Test Against common output' or 'Custom Input' text box. Leave it empty.
   - **CRITICAL**: Do NOT combine `write_code_to_editor` and clicking the **"Run"** button in the same action list. Write code in one step, then click Run in a SEPARATE step.

5. **Construct Correct Code**:
   - Read the problem statement, specifically the **Sample Input** and **Sample Output**.
   - Write code that handles ALL test cases properly (usually multiple test cases with a `T` count).
   - Make sure the output format matches EXACTLY: correct spacing, correct newlines, correct values.
   - If defining functions, ALWAYS invoke them at the bottom (e.g., `solve()` or `if __name__ == '__main__': solve()`).

6. **Run Verification**:
   - Click the **"Run"** button in a SEPARATE step after writing code.
   - Wait 5-8 seconds for execution to complete.
   - **CRITICAL**: Check the console output. Verify that **"Your Output"** matches **"Expected Output"** character-for-character.
   - If there's any mismatch, fix the code, write it again with `write_code_to_editor`, then click **"Run"** again.
   - Repeat until outputs match perfectly.

7. **Submit & Verify**:
   - **ONLY** click **"Submit"** after Run shows matching output.
   - Wait 5-8 seconds after clicking Submit.
   - Verify the page shows **"Correct Answer"** or **"Success"** or a green checkmark.
   - **ONLY** click **"Next"** after seeing **"Correct Answer"** / **"Success"** on screen.

8. **Action Ordering Rule**:
   - When using multiple actions in one step: Click first, then Wait.
   - Example: Action 1 = Click Submit, Action 2 = Wait 8s.
   - NEVER put Wait before Click.

---

## 5. Module-End Dialogue Handling

When a module (sub-topic) is completed, a **dialog box** appears with lesson completion stats. This is critical to handle correctly:

1. **Detection**: The dialog has class `MuiDialog-container MuiDialog-scrollPaper` and contains:
   - `_dialogContainer_dgmb2_17` — the main content
   - `_lessonCompleted_dgmb2_118` — shows "Lesson N"
   - `_solvedCountDetails_dgmb2_220` — shows solved/total problems

2. **Action**: 
   - **CRITICAL**: Click the **"Keep Learning"** button. It is an `<a>` tag with class `_primaryButton_dgmb2_496` and text "Keep Learning". Its `href` attribute points to the next lesson URL.
   - Do NOT interact with the rating stars (`MuiRating-root`).
   - Do NOT click "Upgrade to Pro" (`_proNudgeBanner_dgmb2_635`).
   - Do NOT click "Submit" feedback button (`_secondaryButton_dgmb2_512`).

3. **After clicking "Keep Learning"**:
   - Wait 5 seconds for SPA navigation to complete.
   - The page will load the first slide of the next sub-topic.
   - Re-classify the new page state (Section 1) and continue solving.

---

## 6. Navigation & Progress Bar

### 6.1 Bottom Navigation Bar
The bottom of every slide page has a navigation bar:
- **Back to course**: Arrow back icon linking to the course page (`_sideNavigationContainer_6an6e_171`)
- **Prev**: `<a class="_previous__container_6an6e_113">` with "Prev" or "Prev module" text
- **Progress dots**: `<div class="_contest__progress_6an6e_228">` contains small progress bar segments:
  - Each segment is `<a class="_progress__bar_6an6e_219">` 
  - Filled/completed segments have additional class `_filled_6an6e_247`
  - Current segment has additional styling
- **Next**: `<a class="_next__container_6an6e_133">` with "Next" or "Next module" text
- **Problem solved indicator**: `<i class="_problemSolved__icon_6an6e_255"></i>` appears in the nav bar when the current problem is solved

### 6.2 Sidebar Module List
The left sidebar shows all modules and their sub-topics:
- Sidebar container: `_sidebarContainer_21zhj_2`
- Course name: `_syllabusName_21zhj_46`
- Module accordion: Uses MUI Accordion components
- Sub-topic links: Inside `_submoduleSummary_21zhj_161`, each `<a>` links to a sub-topic
- Lesson names: `_moduleName_21zhj_182`

---

## 7. React Hydration & SPA Rules

- **CRITICAL**: CodeChef is a Single Page Application (SPA). Page transitions happen via client-side React routing.
- After clicking Next, Keep Learning, or any internal navigation link, the page will often appear blank or show skeleton loaders for 3-8 seconds.
- **You MUST NEVER navigate away or use direct URL navigation** unless returning to the course overview page. Manual navigation breaks the SPA client state.
- **Always wait 5-8 seconds** after navigation actions for React to fully hydrate the new page content.
- If a page still appears blank after 10 seconds, try refreshing by navigating to the course overview URL (`/learn/course/<slug>`) and clicking the correct sub-topic from there.

---

## 8. Loop Termination & Module Completion Logic

### 8.1 Solving One Full Module
The task is complete ONLY when the **entire target module** (e.g., "Pre-requisites") shows all sub-topics solved:
- Each sub-topic accordion shows its sub-lessons.
- All sub-lessons must have the solved icon (`_problemSolved__icon_6an6e_255`).
- The overall module progress should show 100% or all items checked.

### 8.2 Sub-Topic Transition Flow
1. Solve all slides within a sub-topic (statement → MCQ → coding, in whatever order they appear).
2. When the last slide triggers the **Module-End Dialogue** → click **"Keep Learning"**.
3. The agent lands on the first slide of the NEXT sub-topic.
4. Re-classify and continue solving.
5. If clicking "Keep Learning" or "Next" redirects to the course overview:
   - Find the first incomplete sub-topic under the target module.
   - Click it to resume.

### 8.3 When to Call `done`
- ONLY call `done` when ALL sub-topics within the assigned module are complete.
- Verify by checking the course overview page — all items under the module should show green checkmarks.
- If the user asked to complete the entire course, continue to the next module until all are done.

---

## 9. Reference: Key CSS Selectors Summary

| Element | CSS Class / Selector |
|---|---|
| User name in header | `_user__fullname_phs6a_1161` |
| Module accordion section | `_modules_21zhj_105` |
| Module title | `_moduleTitle_21zhj_105 > span` |
| Sub-topic link container | `_submoduleSummary_21zhj_161` |
| Sub-topic name | `_moduleName_21zhj_182` |
| Sidebar MCQ chip | `_textChipMCQ_21zhj_226` |
| Sidebar Coding chip | `_textChipCoding_21zhj_226` |
| Sidebar Concept chip | `_textChipConcept_21zhj_226` |
| Problem solved icon (sidebar) | `_status-success_21zhj_208` + `_status__icon_21zhj_208` |
| Problem solved icon (nav bar) | `_problemSolved__icon_6an6e_255` |
| Problem statement body | `_problemBody_bh3c4_71` |
| Statement wrapper | `_problemStatementWrapper_bh3c4_33` |
| Sample I/O table | `_input_output__table_bh3c4_231` |
| Sample input values | `_values_bh3c4_254 > pre` (first) |
| Sample output values | `_values_bh3c4_254 > pre` (second) |
| Next button (bottom nav) | `_next__container_6an6e_133` |
| Prev button (bottom nav) | `_previous__container_6an6e_113` |
| Progress bar segment | `_progress__bar_6an6e_219` |
| Filled progress segment | `_filled_6an6e_247` |
| **MCQ container (RIGHT panel)** | `_mcq_duw07_2` |
| **MCQ inner container** | `_mcqContainer_duw07_16` |
| **MCQ question heading** | `_mcqStatement_duw07_29 > h2` |
| **MCQ options container** | `_optionsContainer_duw07_35` |
| **MCQ single option label** | `_optionBox_duw07_41` |
| **MCQ option text** | `_label_duw07_50` |
| **MCQ Submit button** | `button#submit_btn._submit__btn_duw07_276` |
| **MCQ Next button** | `_next__problem-link_duw07_238` |
| **MCQ result area** | `_runContainer_duw07_195` |
| Module-end dialog | `MuiDialog-container` + `_dialogContainer_dgmb2_17` |
| Keep Learning button | `_primaryButton_dgmb2_496` |
| Lesson completed label | `_lessonCompleted_dgmb2_118` |
| XP gained | `_xpGain_dgmb2_363` |
| Course progress bar | `_progressBar_dgmb2_402` |
| Back to course link | `_sideNavigationContainer_6an6e_171` |
| Sidebar container | `_sidebarContainer_21zhj_2` |
| Course name in sidebar | `_syllabusName_21zhj_46` |
| Tab: Statement | `vertical-tab-panel-0` |
| Tab: Help | `vertical-tab-panel-1` |
| Difficulty rating | `_difficultyRatings__box_6an6e_176` |
| Bookmark | `_bookmarkIcon_pwmwe_15` |
